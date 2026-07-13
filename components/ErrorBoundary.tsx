// 全 codebase 唯一 class component：componentDidCatch／getDerivedStateFromError 沒有 hooks 等價物，error boundary 必須用 class。
import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // 完整錯誤與 componentStack 只進 console，不渲染到 UI（避免資訊洩漏）。
    console.error('ErrorBoundary caught an error:', error, errorInfo.componentStack);
  }

  render() {
    if (this.state.error === null) {
      return this.props.children;
    }

    // Fallback UI：boundary 觸發時不能假設 CSS/Tailwind 健在，關鍵樣式一律 inline style；
    // 也不 import 任何專案元件，避免 fallback 自身再 throw。
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#0f172a',
          color: '#e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          fontFamily: 'sans-serif',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '12px' }}>
          頁面發生錯誤
        </h1>
        <p
          style={{
            color: '#94a3b8',
            wordBreak: 'break-word',
            maxWidth: '640px',
            textAlign: 'center',
            marginBottom: '24px',
          }}
        >
          {this.state.error.message}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            backgroundColor: '#2563eb',
            color: '#ffffff',
            padding: '10px 24px',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '1rem',
          }}
        >
          重新載入
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
