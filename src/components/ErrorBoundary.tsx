import React, { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Невідома помилка' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-page text-gray-200 flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full rounded-2xl border border-red-500/25 bg-red-500/5 p-6 space-y-4">
            <h1 className="text-lg font-bold text-white">Щось пішло не так</h1>
            <p className="text-sm text-gray-400">
              Інтерфейс зупинився через помилку відображення. Спробуйте оновити сторінку.
            </p>
            <pre className="text-xs text-red-300/90 whitespace-pre-wrap break-words max-h-40 overflow-auto">
              {this.state.message}
            </pre>
            <button
              type="button"
              className="chaika-btn-primary w-full py-3 text-sm font-semibold"
              onClick={() => window.location.reload()}
            >
              Оновити сторінку
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
