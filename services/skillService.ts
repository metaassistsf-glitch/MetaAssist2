import { db } from "../firebase";
import { collection, query, where, getDocs, doc, setDoc } from "firebase/firestore";
import { Skill } from "../types";

export const getRelevantSkills = async (category: string, subCategory?: string): Promise<Skill[]> => {
  try {
    const skillsRef = collection(db, "skills");
    // Search both the general category and specifically for the subcategory if provided
    const q = query(skillsRef, where("category", "in", [category, "general", subCategory].filter(Boolean) as string[]));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => doc.data() as Skill);
  } catch (error) {
    console.error("Error fetching skills:", error);
    return [];
  }
};

export const saveSkill = async (skill: Skill): Promise<void> => {
  try {
    const skillDoc = doc(db, "skills", skill.id);
    await setDoc(skillDoc, {
      ...skill,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Error saving skill:", error);
    throw error;
  }
};

export const getAllSkills = async (): Promise<Skill[]> => {
  try {
    const snapshot = await getDocs(collection(db, "skills"));
    return snapshot.docs.map(doc => doc.data() as Skill);
  } catch (error) {
    console.error("Error fetching all skills:", error);
    return [];
  }
};
