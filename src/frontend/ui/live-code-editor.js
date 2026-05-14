/**
 * Live Code Editor - CodeMirror 5 with Hydra-style transparent highlighting
 */

export class LiveCodeEditor {
  constructor(containerId, onExecute) {
    this.container = document.getElementById(containerId);
    this.onExecute = onExecute;
    this.editor = null;
  }
  
  async initialize(initialCode = '') {
    let attempts = 0;
    while (!window.CodeMirror && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    if (!window.CodeMirror) {
      console.error('CodeMirror failed to load');
      return;
    }
    
    this.editor = window.CodeMirror(this.container, {
      value: initialCode,
      mode: 'javascript',
      theme: 'tomorrow-night-eighties',
      lineNumbers: true,
      lineWrapping: false,
      styleActiveLine: { nonEmpty: false },
      extraKeys: {
        'Ctrl-Enter': () => {
          if (this.onExecute) {
            this.onExecute(this.getValue());
          }
          return true;
        }
      }
    });
    
    this.applyCustomStyling();
    console.log('✓ Live code editor initialized');
  }
  
  applyCustomStyling() {
    const wrapper = this.editor.getWrapperElement();
    
    wrapper.style.position = 'absolute';
    wrapper.style.top = '0';
    wrapper.style.left = '0';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.pointerEvents = 'all';
    
    if (!document.getElementById('cm-hydra-styles')) {
      const style = document.createElement('style');
      style.id = 'cm-hydra-styles';
      style.textContent = `
        .CodeMirror {
          background: rgba(0, 0, 0, 0) !important;
          transition: background-color 0.3s ease;
          color: #cccccc;
          font-size: 24px;
          height: 100%;
        }
        
        .CodeMirror-scroll {
          background: transparent !important;
          overflow-x: auto !important;
          overflow-y: auto !important;
        }
        
        .CodeMirror-line span {
          background-color: rgba(0, 0, 0, 0.3);
          transition: background-color 0.3s ease;
        }
        
        .CodeMirror-line span span {
          background-color: rgba(0, 0, 0, 0);
        }
        
        .CodeMirror-activeline-background {
          background: rgba(245, 32, 32, 0.6) !important;
        }
        
        .CodeMirror-activeline-gutter {
          background: rgba(245, 32, 32, 0.6) !important;
        }
        
        .CodeMirror-gutters {
          background: #000000 !important;
          border-right: 0px;
        }
        
        .CodeMirror-linenumber {
          color: #515151;
        }
        
        .CodeMirror-cursor {
          border-left: 3px solid #999 !important;
        }
        
        .CodeMirror-selected {
          background: #666666 !important;
        }
        
        .CodeMirror-line::selection,
        .CodeMirror-line > span::selection,
        .CodeMirror-line > span > span::selection {
          background: rgba(45, 45, 45, 0.99);
        }
        
        .CodeMirror-line::-moz-selection,
        .CodeMirror-line > span::-moz-selection,
        .CodeMirror-line > span > span::-moz-selection {
          background: rgba(45, 45, 45, 0.99);
        }
        
        .cm-comment { color: #d27b53; }
        .cm-atom { color: #a16a94; }
        .cm-number { color: #a16a94; }
        .cm-property { color: #99cc99; }
        .cm-attribute { color: #99cc99; }
        .cm-keyword { color: #f2777a; }
        .cm-string { color: #ffcc66; }
        .cm-variable { color: #99cc99; }
        .cm-variable-2 { color: #6699cc; }
        .cm-def { color: #f99157; }
        .cm-bracket { color: #cccccc; }
        .cm-tag { color: #f2777a; }
        .cm-link { color: #a16a94; }
        .cm-error { background: #f2777a; color: #6a6a6a; }
        
        .CodeMirror-matchingbracket {
          text-decoration: underline;
          color: white !important;
        }
        
        .CodeMirror-hscrollbar {
          display: block !important;
          height: 8px;
          background: rgba(0, 0, 0, 0.3) !important;
        }
        
        .CodeMirror-hscrollbar div {
          background: rgba(255, 255, 255, 0.3) !important;
          border-radius: 4px;
        }
        
        .CodeMirror-vscrollbar {
          display: block !important;
          width: 8px;
          background: rgba(0, 0, 0, 0.3) !important;
        }
        
        .CodeMirror-vscrollbar div {
          background: rgba(255, 255, 255, 0.3) !important;
          border-radius: 4px;
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  getValue() {
    return this.editor ? this.editor.getValue() : '';
  }
  
  setValue(code) {
    if (this.editor) {
      this.editor.setValue(code);
    }
  }
  
  focus() {
    if (this.editor) {
      this.editor.focus();
    }
  }
  
  destroy() {
    if (this.editor) {
      this.editor.toTextArea();
      this.editor = null;
    }
  }
}