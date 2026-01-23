export class CursorNavigationHandler {
  constructor(liveCodeEditor, websocketClient) {
    this.editor = liveCodeEditor;
    this.wsClient = websocketClient;
    this.currentLine = 0;
    this.currentSegmentIndex = 0;
    this.currentLineSegments = [];
    
    this.wsClient.onCursorNavigate = (data) => this.handleNavigation(data);
    this.wsClient.onCursorClick = (data) => this.handleClick(data);
  }
  
  handleNavigation(data) {
    if (data.nav_type === 'line') {
      this.navigateLine(data.direction);
    } else if (data.nav_type === 'segment') {
      this.navigateSegment(data.direction);
    }
  }
  
  handleClick(data) {
    if (data.click_type === 'double_click') {
      this.selectCurrentSegment();
    }
  }
  
  navigateLine(direction) {
    const editor = this.editor.editor;
    if (!editor) return;
    
    const lineCount = editor.lineCount();
    this.currentLine += direction;
    
    if (this.currentLine < 0) {
      this.currentLine = lineCount - 1;
    } else if (this.currentLine >= lineCount) {
      this.currentLine = 0;
    }
    
    this.currentLineSegments = this.findSegments(this.currentLine);
    this.currentSegmentIndex = 0;
    
    const ch = this.currentLineSegments.length > 0 ? this.currentLineSegments[0].start : 0;
    editor.setCursor({ line: this.currentLine, ch });
    editor.focus();
  }
  
  navigateSegment(direction) {
    const editor = this.editor.editor;
    if (!editor) return;
    
    if (this.currentLineSegments.length === 0) {
      const cursor = editor.getCursor();
      this.currentLine = cursor.line;
      this.currentLineSegments = this.findSegments(this.currentLine);
      this.currentSegmentIndex = this.findCurrentSegmentIndex(cursor.ch);
    }
    
    if (this.currentLineSegments.length === 0) return;
    
    this.currentSegmentIndex += direction;
    
    if (this.currentSegmentIndex < 0) {
      this.navigateLine(-1);
      this.currentSegmentIndex = Math.max(0, this.currentLineSegments.length - 1);
    } else if (this.currentSegmentIndex >= this.currentLineSegments.length) {
      this.navigateLine(1);
      this.currentSegmentIndex = 0;
    }
    
    const segment = this.currentLineSegments[this.currentSegmentIndex];
    if (segment) {
      editor.setCursor({ line: this.currentLine, ch: segment.start });
      editor.focus();
    }
  }
  
  findSegments(lineNum) {
    const editor = this.editor.editor;
    if (!editor) return [];
    
    const line = editor.getLine(lineNum);
    if (!line) return [];
    
    const segments = [];
    const segmentRegex = /\b\w+\b|"[^"]*"|'[^']*'|\d+\.?\d*/g;
    
    let match;
    while ((match = segmentRegex.exec(line)) !== null) {
      const text = match[0];
      if (!text.match(/^[,:{}()\[\]]+$/)) {
        segments.push({
          text: text,
          start: match.index,
          end: match.index + text.length
        });
      }
    }
    
    return segments;
  }
  
  findCurrentSegmentIndex(ch) {
    for (let i = 0; i < this.currentLineSegments.length; i++) {
      const seg = this.currentLineSegments[i];
      if (ch >= seg.start && ch <= seg.end) {
        return i;
      }
    }
    
    let nearest = 0;
    let minDist = Infinity;
    
    for (let i = 0; i < this.currentLineSegments.length; i++) {
      const seg = this.currentLineSegments[i];
      const dist = Math.min(Math.abs(ch - seg.start), Math.abs(ch - seg.end));
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    }
    
    return nearest;
  }
  
  selectCurrentSegment() {
    const editor = this.editor.editor;
    if (!editor) return;
    
    const cursor = editor.getCursor();
    this.currentLine = cursor.line;
    this.currentLineSegments = this.findSegments(this.currentLine);
    
    if (this.currentLineSegments.length === 0) return;
    
    this.currentSegmentIndex = this.findCurrentSegmentIndex(cursor.ch);
    const segment = this.currentLineSegments[this.currentSegmentIndex];
    
    if (segment) {
      let startCh = segment.start;
      let endCh = segment.end;
      
      const text = segment.text;
      if ((text.startsWith('"') && text.endsWith('"')) || 
          (text.startsWith("'") && text.endsWith("'"))) {
        startCh += 1;
        endCh -= 1;
      }
      
      editor.setSelection(
        { line: this.currentLine, ch: startCh },
        { line: this.currentLine, ch: endCh }
      );
      editor.focus();
    }
  }
}