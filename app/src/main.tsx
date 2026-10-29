import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/library.css';
import './styles/settings.css';
import './styles/reader.css';
import { startPlatformBridge } from './platform/bridge';
import { currentOs } from './platform/os';

// 平台标记：样式里用 html[data-os="mac"] 区分 mac 的外观（字体、红黄绿让位），见 tokens.css、reader.css
document.documentElement.dataset.os = currentOs();

// 只在需要时才注册 <foliate-view>：reader/controller 会 import 'foliate-js/view.js'
createRoot(document.getElementById('root')!).render(<App />);
startPlatformBridge();
