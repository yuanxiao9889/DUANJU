import * as pdfjs from 'pdfjs-dist';
import * as mammoth from 'mammoth';

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export interface ParsedScriptContent {
  title: string;
  rawText: string;
  scenes: ParsedScene[];
}

export interface ParsedScene {
  heading: string;
  content: string;
  lineStart: number;
  lineEnd: number;
}

export async function parseDocument(file: File): Promise<ParsedScriptContent> {
  const fileName = file.name.toLowerCase();
  
  if (fileName.endsWith('.txt')) {
    return parseTxtFile(file);
  } else if (fileName.endsWith('.pdf')) {
    return parsePdfFile(file);
  } else if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
    return parseDocxFile(file);
  } else {
    throw new Error(`不支持的文件格式: ${fileName}`);
  }
}

async function parseTxtFile(file: File): Promise<ParsedScriptContent> {
  const text = await file.text();
  return parseScriptText(text, file.name.replace(/\.[^/.]+$/, ''));
}

async function parsePdfFile(file: File): Promise<ParsedScriptContent> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      fullText += pageText + '\n';
    }
    
    return parseScriptText(fullText, file.name.replace(/\.pdf$/i, ''));
  } catch (error) {
    console.error('PDF parse error:', error);
    throw new Error(`PDF 解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

async function parseDocxFile(file: File): Promise<ParsedScriptContent> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return parseScriptText(result.value, file.name.replace(/\.(docx|doc)$/i, ''));
  } catch (error) {
    console.error('Word parse error:', error);
    throw new Error(`Word 解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

export function parseScriptText(text: string, title: string): ParsedScriptContent {
  const lines = text.split('\n');
  const scenes: ParsedScene[] = [];
  
  const sceneHeadingRegex = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*.+/i;
  
  let currentScene: ParsedScene | null = null;
  let sceneContent: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNumber = i + 1;
    
    if (sceneHeadingRegex.test(line)) {
      if (currentScene) {
        currentScene.content = sceneContent.join('\n').trim();
        scenes.push(currentScene);
      }
      
      currentScene = {
        heading: line,
        content: '',
        lineStart: lineNumber,
        lineEnd: lineNumber,
      };
      sceneContent = [];
    } else if (currentScene && line) {
      sceneContent.push(lines[i]);
    }
    
    if (currentScene) {
      currentScene.lineEnd = lineNumber;
    }
  }
  
  if (currentScene) {
    currentScene.content = sceneContent.join('\n').trim();
    scenes.push(currentScene);
  }
  
  return {
    title,
    rawText: text,
    scenes: scenes.length > 0 ? scenes : [{ heading: '全文', content: text, lineStart: 1, lineEnd: lines.length }],
  };
}

export function detectCharacterNames(scenes: ParsedScene[]): string[] {
  const characterSet = new Set<string>();
  const characterNameRegex = /^[A-Z][A-Z\s]+(?=\s*$)/m;
  
  for (const scene of scenes) {
    const lines = scene.content.split('\n');
    for (const line of lines) {
      const match = line.match(characterNameRegex);
      if (match) {
        const name = match[0].trim();
        if (name.length > 1 && name.length < 20) {
          characterSet.add(name);
        }
      }
    }
  }
  
  return Array.from(characterSet).sort();
}

export function detectLocations(scenes: ParsedScene[]): string[] {
  const locationSet = new Set<string>();
  const sceneHeadingRegex = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*(.+?)(?:\s*-\s*(.+))?$/i;
  
  for (const scene of scenes) {
    const match = scene.heading.match(sceneHeadingRegex);
    if (match) {
      const location = match[2]?.trim() || match[1];
      if (location) {
        locationSet.add(location);
      }
    }
  }
  
  return Array.from(locationSet).sort();
}
