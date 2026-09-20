// 直接使用共用Modal，僅提供可觀察的動態內容與兩層開啟場景；不存取React內部。
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Modal from '../../../../components/ui/Modal';

function Harness() {
  const [open, setOpen] = useState(false), [inner, setInner] = useState(false), [empty, setEmpty] = useState(false);
  const [source, setSource] = useState(true), [sourceDisabled, setSourceDisabled] = useState(false);
  const [disabled, setDisabled] = useState(false), [hidden, setHidden] = useState(false);
  const [conditional, setConditional] = useState(false);
  const close = () => { setOpen(false); setInner(false); };
  return <main className="p-4 space-y-3">
    <h1>共用視窗鍵盤驗收</h1>
    {source && <button id="open" disabled={sourceDisabled} onClick={() => setOpen(true)}>開啟測試視窗</button>}
    <button id="fallback">返回控制</button>
    <button id="empty" onClick={() => setEmpty(true)}>無控制項視窗</button>
    <button id="conditional" onClick={() => setConditional(true)}>條件掛載視窗</button>
    <Modal open={open} onClose={close} title="外層測試視窗" maxWidth="max-w-md">
      <div className="space-y-3">
        <button id="disable" disabled={disabled} onClick={() => setDisabled(true)}>停用目前按鈕</button>
        <button id="hide" hidden={hidden} onClick={() => setHidden(true)}>隱藏目前按鈕</button>
        <button id="remove-source" onClick={() => setSource(false)}>移除來源按鈕</button>
        <button id="disable-source" onClick={() => setSourceDisabled(true)}>停用來源按鈕</button>
        <button id="inner" onClick={() => setInner(true)}>開啟內層</button>
        {Array.from({ length: 35 }, (_, i) => <p key={i}>第{i + 1}段長內容，確認視窗內可以捲動且焦點保持可見。</p>)}
        <button id="last" onClick={close}>確認操作</button>
        <Modal open={inner} onClose={() => setInner(false)} title="內層測試視窗" maxWidth="max-w-sm">
          <input aria-label="內層文字" />
          <button id="inner-last" onClick={() => setInner(false)}>關閉內層</button>
        </Modal>
      </div>
    </Modal>
    <Modal open={empty} onClose={() => setEmpty(false)}>此視窗沒有可操作子項目。</Modal>
    {conditional && <Modal open onClose={() => setConditional(false)} title="條件掛載測試">
      <button id="conditional-last" onClick={() => setConditional(false)}>確認條件視窗</button>
    </Modal>}
  </main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><Harness /></React.StrictMode>);
