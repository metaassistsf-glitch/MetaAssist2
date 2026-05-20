import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorMessage = this.state.error?.message || 'Unknown error';
      let isFirestoreError = false;
      let firestoreDetails = null;

      try {
        if (errorMessage.startsWith('{')) {
          firestoreDetails = JSON.parse(errorMessage);
          if (firestoreDetails.operationType) {
            isFirestoreError = true;
            errorMessage = `Firestore ${firestoreDetails.operationType} error at ${firestoreDetails.path || 'unknown path'}: ${firestoreDetails.error}`;
          }
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-[32px] p-10 shadow-2xl text-center">
            <div className={`w-20 h-20 ${isFirestoreError ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'} rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-inner`}>
              <i className={`fas ${isFirestoreError ? 'fa-database' : 'fa-bug'} text-3xl`}></i>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-3">
              {isFirestoreError ? 'Database Error' : 'Something went wrong'}
            </h2>
            <p className="text-slate-500 text-sm mb-8 font-medium leading-relaxed">
              {isFirestoreError 
                ? "We encountered a problem while communicating with the database. This might be due to missing permissions or a network issue."
                : "We encountered an unexpected error. Please try refreshing the page."}
            </p>
            <div className="bg-slate-100 p-4 rounded-xl mb-8 text-left overflow-auto max-h-40">
              <code className="text-xs text-slate-600 font-mono break-all">
                {errorMessage}
              </code>
            </div>
            <button
              onClick={() => window.location.reload()}
              className={`w-full py-4 ${isFirestoreError ? 'bg-amber-600 shadow-amber-500/20 hover:bg-amber-700' : 'bg-rose-600 shadow-rose-500/20 hover:bg-rose-700'} text-white font-bold rounded-2xl shadow-xl transition-all uppercase tracking-widest text-xs`}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
