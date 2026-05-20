
import { SalesforceService } from './salesforceService';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParentRelationship {
  parentObject: string;
  parentKeyField: string; // The field in parent file used as key
  childLookupField: string; // The field in child file containing the parent key
  sfLookupField: string; // The Salesforce API name of the lookup field (e.g. AccountId)
}

export interface DataLoaderFile {
  name: string;
  objectName: string;
  data: any[];
  fields: string[];
  externalIdField?: string;
  parentRelationships?: ParentRelationship[];
  fieldMapping?: Record<string, string>; // CSV Header -> Salesforce API Name
}

export interface DeploymentResult {
  objectName: string;
  total: number;
  success: number;
  failed: number;
  errors: any[];
}

export class DataLoaderService {
  private sfService: SalesforceService;
  private idMap: Map<string, string> = new Map(); // ObjectName_ExternalId -> Salesforce ID

  constructor(sfService: SalesforceService) {
    this.sfService = sfService;
  }

  async parseFile(file: File): Promise<{ data: any[]; fields: string[] }> {
    return new Promise((resolve, reject) => {
      const extension = file.name.split('.').pop()?.toLowerCase();

      if (extension === 'csv') {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            resolve({
              data: results.data,
              fields: results.meta.fields || [],
            });
          },
          error: (error) => reject(error),
        });
      } else if (extension === 'xlsx' || extension === 'xls') {
        const reader = new FileReader();
        reader.onload = (e) => {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const json = XLSX.utils.sheet_to_json(worksheet) as any[];
          const fields = (json && json.length > 0) ? Object.keys(json[0] as object) : [];
          resolve({ data: json || [], fields });
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
      } else {
        reject(new Error('Unsupported file format. Please upload CSV or Excel.'));
      }
    });
  }

  async deployHierarchy(
    files: DataLoaderFile[],
    onProgress: (result: DeploymentResult) => void
  ): Promise<void> {
    this.idMap.clear();

    const sortedFiles = this.sortFilesByDependency(files);

    for (const file of sortedFiles) {
      await this.deployFile(file, onProgress);
    }
  }

  private sortFilesByDependency(files: DataLoaderFile[]): DataLoaderFile[] {
    const sorted: DataLoaderFile[] = [];
    const visited = new Set<string>();

    const visit = (file: DataLoaderFile) => {
      if (visited.has(file.objectName)) return;
      
      if (file.parentRelationships) {
        file.parentRelationships.forEach(rel => {
          const parentFile = files.find(f => f.objectName === rel.parentObject);
          if (parentFile) {
            visit(parentFile);
          }
        });
      }

      visited.add(file.objectName);
      sorted.push(file);
    };

    files.forEach(file => visit(file));
    return sorted;
  }

  private async deployFile(
    file: DataLoaderFile, 
    onProgress: (result: DeploymentResult) => void
  ): Promise<DeploymentResult> {
    const { objectName, data, parentRelationships } = file;
    let success = 0;
    let failed = 0;
    const errors: any[] = [];

    // Prepare data
    const processedData = data.map(record => {
      const newRecord: any = {};
      
      // Map CSV headers to Salesforce fields
      if (file.fieldMapping) {
        Object.entries(file.fieldMapping).forEach(([csvHeader, sfField]) => {
          if (sfField && record[csvHeader] !== undefined) {
            newRecord[sfField] = record[csvHeader];
          }
        });
      } else {
        Object.assign(newRecord, record);
      }
      
      // Inject parent IDs
      if (parentRelationships) {
        parentRelationships.forEach(rel => {
          const externalIdValue = record[rel.childLookupField];
          if (externalIdValue) {
            const realId = this.idMap.get(`${rel.parentObject}_${externalIdValue}`);
            if (realId) {
              newRecord[rel.sfLookupField] = realId;
            }
          }
        });
      }
      
      return newRecord;
    });

    try {
      // 1. Create Job
      const job = await this.sfService.createBulkJob(objectName);
      const jobId = job.id;

      // 2. Upload Data (CSV)
      const csvData = this.jsonToCsv(processedData);
      await this.sfService.uploadBulkData(jobId, csvData);

      // 3. Close Job
      await this.sfService.closeBulkJob(jobId);

      // 4. Poll for status
      let jobStatus = await this.sfService.getBulkJobStatus(jobId);
      while (jobStatus.state !== 'JobComplete' && jobStatus.state !== 'Failed' && jobStatus.state !== 'Aborted') {
        await new Promise(resolve => setTimeout(resolve, 3000));
        jobStatus = await this.sfService.getBulkJobStatus(jobId);
      }

      if (jobStatus.state === 'JobComplete') {
        const successResults = await this.sfService.getBulkJobSuccessfulResults(jobId);
        const failedResults = await this.sfService.getBulkJobFailedResults(jobId);

        const successRows = successResults.split('\n').filter(line => line.trim() !== '');
        const failedRows = failedResults.split('\n').filter(line => line.trim() !== '');

        success = Math.max(0, successRows.length - 1);
        failed = Math.max(0, failedRows.length - 1);

        if (failed > 0) {
          errors.push('Some records failed. Check Bulk Job results in Salesforce.');
        }

        // Map IDs for children if external ID field is provided
        if (success > 0 && file.externalIdField) {
          const headers = successRows[0].split(',').map(h => h.replace(/"/g, '').trim());
          const idIdx = headers.indexOf('sf__Id');
          
          // Find the Salesforce field name that corresponds to the externalIdField
          const sfExternalIdField = file.fieldMapping[file.externalIdField];
          const extIdIdx = headers.indexOf(sfExternalIdField);

          if (idIdx !== -1 && extIdIdx !== -1) {
            for (let j = 1; j < successRows.length; j++) {
              const columns = successRows[j].split(',').map(c => c.replace(/"/g, '').trim());
              const newId = columns[idIdx];
              const externalIdValue = columns[extIdIdx];
              if (newId && externalIdValue) {
                this.idMap.set(`${objectName}_${externalIdValue}`, newId);
              }
            }
          } else {
            // Fallback to order-based mapping if columns not found
            console.warn(`Could not find columns for ID mapping: idIdx=${idIdx}, extIdIdx=${extIdIdx}. Falling back to order-based mapping.`);
            for (let j = 1; j < successRows.length; j++) {
              const columns = successRows[j].split(',').map(c => c.replace(/"/g, '').trim());
              const newId = columns[idIdx !== -1 ? idIdx : 0]; // Assume first column is ID if not found
              const externalIdValue = data[j-1][file.externalIdField];
              if (newId && externalIdValue) {
                this.idMap.set(`${objectName}_${externalIdValue}`, newId);
              }
            }
          }
        }
      } else {
        throw new Error(`Bulk Job ${jobId} failed with state: ${jobStatus.state}`);
      }
    } catch (e: any) {
      failed = data.length;
      errors.push(e.message);
    }

    const finalResult = {
      objectName,
      total: data.length,
      success,
      failed,
      errors
    };

    onProgress(finalResult);
    return finalResult;
  }
  public jsonToCsv(data: any[]): string {
    if (data.length === 0) return '';
    const headers = Object.keys(data[0]);
    const csvRows = [];
    csvRows.push(headers.join(','));
    for (const row of data) {
      const values = headers.map(header => {
        const val = row[header];
        if (val === null || val === undefined) return '';
        const escaped = ('' + val).replace(/"/g, '""');
        return `"${escaped}"`;
      });
      csvRows.push(values.join(','));
    }
    return csvRows.join('\n');
  }
}
