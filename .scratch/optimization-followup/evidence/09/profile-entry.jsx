// 使用完整真實 App；Profiler只觀察公開React回呼，不讀私有state/fiber。
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../../../App';

createRoot(document.getElementById('root')).render(<App />);
