import { CANVAS_NODE_TYPES, type ScriptChapterNodeData } from '../domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';

interface AssetData {
  name: string;
  description: string;
  personality?: string;
  appearance?: string;
}

export function extractAssetsFromChapters() {
  const { nodes, addNode } = useCanvasStore();
  
  const chapters = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptChapter) as Array<{
    id: string;
    data: ScriptChapterNodeData;
  }>;

  if (chapters.length === 0) {
    return { characters: 0, locations: 0, items: 0 };
  }

  const allContent = chapters
    .map((c) => c.data.content || '')
    .join('\n');
  
  const allSceneHeadings = chapters
    .flatMap((c) => c.data.sceneHeadings || [])
    .join('\n');

  const characters = extractCharacters(allContent);
  const locations = extractLocations(allSceneHeadings);
  const items = extractItems(allContent);

  const existingCharacters = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptCharacter);
  const existingLocations = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptLocation);
  const existingItems = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptItem);

  const existingNames = new Set([
    ...existingCharacters.map((n: any) => n.data.name?.toLowerCase()),
    ...existingLocations.map((n: any) => n.data.name?.toLowerCase()),
    ...existingItems.map((n: any) => n.data.name?.toLowerCase()),
  ]);

  let charCount = 0;
  let locCount = 0;
  let itemCount = 0;

  characters.forEach((char) => {
    if (!existingNames.has(char.name.toLowerCase())) {
      addNode(CANVAS_NODE_TYPES.scriptCharacter, { x: 600, y: 100 + charCount * 120 }, {
        displayName: char.name,
        name: char.name,
        description: char.description,
        personality: char.personality,
        appearance: char.appearance,
      });
      charCount++;
      existingNames.add(char.name.toLowerCase());
    }
  });

  locations.forEach((loc) => {
    if (!existingNames.has(loc.name.toLowerCase())) {
      addNode(CANVAS_NODE_TYPES.scriptLocation, { x: 850, y: 100 + locCount * 120 }, {
        displayName: loc.name,
        name: loc.name,
        description: loc.description,
      });
      locCount++;
      existingNames.add(loc.name.toLowerCase());
    }
  });

  items.forEach((item) => {
    if (!existingNames.has(item.name.toLowerCase())) {
      addNode(CANVAS_NODE_TYPES.scriptItem, { x: 1100, y: 100 + itemCount * 120 }, {
        displayName: item.name,
        name: item.name,
        description: item.description,
      });
      itemCount++;
    }
  });

  return {
    characters: charCount,
    locations: locCount,
    items: itemCount,
  };
}

function extractCharacters(content: string): AssetData[] {
  const characters: AssetData[] = [];
  const lines = content.split('\n');
  
  const characterNameRegex = /^[【\[]?([A-Z][A-Z\s\u4e00-\u9fa5]{1,20})[\]】]?$/;
  const dialogueRegex = /^([A-Z\u4e00-\u9fa5]{1,10})\s*[:：]/;
  
  const detectedNames = new Set<string>();

  lines.forEach((line) => {
    const trimmed = line.trim();
    
    const nameMatch = trimmed.match(characterNameRegex);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      if (name.length >= 2 && name.length <= 15 && !detectedNames.has(name)) {
        detectedNames.add(name);
        characters.push({
          name,
          description: '',
        });
      }
    }
    
    const dialogueMatch = trimmed.match(dialogueRegex);
    if (dialogueMatch) {
      const name = dialogueMatch[1].trim();
      if (name.length >= 2 && !detectedNames.has(name)) {
        detectedNames.add(name);
        characters.push({
          name,
          description: '',
        });
      }
    }
  });

  return characters.slice(0, 20);
}

function extractLocations(sceneHeadings: string): AssetData[] {
  const locations: AssetData[] = [];
  const sceneRegex = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s*(.+?)(?:\s*[-–]\s*(.+))?$/gim;
  
  let match;
  const seen = new Set<string>();
  
  while ((match = sceneRegex.exec(sceneHeadings)) !== null) {
    const location = match[2]?.trim();
    if (location && location.length < 50 && !seen.has(location.toLowerCase())) {
      seen.add(location.toLowerCase());
      locations.push({
        name: location,
        description: '',
      });
    }
  }

  return locations.slice(0, 20);
}

function extractItems(content: string): AssetData[] {
  const items: AssetData[] = [];
  
  const itemKeywords = ['刀', '枪', '钥匙', '信封', '照片', '项链', '戒指', '盒子', '文件', '电脑', '手机', '书', '药', '瓶子', '包', '车', '船', '飞机'];
  
  const lines = content.split('\n');
  const seen = new Set<string>();
  
  lines.forEach((line) => {
    itemKeywords.forEach((keyword) => {
      if (line.includes(keyword) && !seen.has(keyword)) {
        seen.add(keyword);
        items.push({
          name: keyword,
          description: '',
        });
      }
    });
  });

  return items.slice(0, 15);
}
