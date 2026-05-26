export class LiveCodeEditor {
  constructor(containerId, onExecute) {
    this.editor = window.CodeMirror(document.getElementById(containerId), {
      mode: 'javascript',
      theme: 'tomorrow-night-eighties',
      lineNumbers: true,
      styleActiveLine: { nonEmpty: false },
      extraKeys: { 'Ctrl-Enter': () => onExecute() },
    });
  }
  getValue()       { return this.editor.getValue(); }
  setValue(code)   { this.editor.setValue(code); }
}