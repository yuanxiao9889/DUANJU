# 阿里云模型选择功能设计

## 目标
在设置页面中，为阿里云百炼和阿里云 Coding Plan 分别提供独立的模型选择功能。

## 关键说明
- 阿里云百炼 (Alibaba) 和阿里云 Coding Plan 使用**不同的 API Key**
- 两者是独立的 Provider，需要分别显示和配置

## 实现步骤

### 1. 创建前端模型选项定义
**文件**: `src/features/canvas/models/providers/alibaba.ts`

```typescript
export const ALIBABA_TEXT_MODEL_OPTIONS = [
  { value: 'qwen-turbo', label: 'Qwen Turbo (快速)' },
  { value: 'qwen-plus', label: 'Qwen Plus (平衡)' },
  { value: 'qwen-max', label: 'Qwen Max (最强)' },
  { value: 'qwen2.5-7b-instruct', label: 'Qwen2.5 7B' },
  { value: 'qwen2.5-14b-instruct', label: 'Qwen2.5 14B' },
  { value: 'qwen2.5-72b-instruct', label: 'Qwen2.5 72B' },
] as const;

export const provider: ModelProviderDefinition = {
  id: 'alibaba',
  name: 'Alibaba Cloud',
  label: '阿里云百炼',
};
```

**文件**: `src/features/canvas/models/providers/coding.ts`

```typescript
export const CODING_MODEL_OPTIONS = [
  { value: 'qwen-coder-turbo', label: 'Qwen Coder Turbo' },
  { value: 'qwen-coder-plus', label: 'Qwen Coder Plus' },
  { value: 'qwen-coder-32b', label: 'Qwen Coder 32B' },
  { value: 'qwen2.5-coder-7b-instruct', label: 'Qwen2.5 Coder 7B' },
] as const;
```

### 2. 添加 Settings Store 状态
**文件**: `src/stores/settingsStore.ts`

```typescript
interface SettingsState {
  // 现有字段...
  
  // 阿里云百炼模型
  alibabaTextModel: string;
  // Coding Plan 模型
  codingModel: string;
}

// 默认值
DEFAULT_ALIBABA_TEXT_MODEL = 'qwen-plus'
DEFAULT_CODING_MODEL = 'qwen-coder-plus'

// 设置函数
setAlibabaTextModel: (model: string) => void
setCodingModel: (model: string) => void
```

### 3. 在设置界面添加模型选择
**文件**: `src/components/SettingsDialog.tsx`

参考 Grsai 实现方式：
1. 导入模型选项常量
2. 添加 `localAlibabaTextModel` 和 `localCodingModel` 状态
3. 在遍历 providers 时，检查 `provider.id === 'alibaba'`，显示模型选择下拉框
4. 同样处理 `provider.id === 'coding'`

```tsx
// 导入
import { ALIBABA_TEXT_MODEL_OPTIONS } from '@/features/canvas/models/providers/alibaba';
import { CODING_MODEL_OPTIONS } from '@/features/canvas/models/providers/coding';

// 在 provider 渲染逻辑中
{provider.id === 'alibaba' && (
  <UiSelect value={localAlibabaTextModel} onChange={...}>
    {ALIBABA_TEXT_MODEL_OPTIONS.map(opt => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </UiSelect>
)}

{provider.id === 'coding' && (
  <UiSelect value={localCodingModel} onChange={...}>
    {CODING_MODEL_OPTIONS.map(opt => (
      <option key={opt.value} value={opt.value}>{opt.label}</option>
    ))}
  </UiSelect>
)}
```

### 4. 传递模型到后端
**文件**: `src/commands/textGen.ts`

修改 `generateText`，在未指定模型时使用设置中的默认值：
```typescript
import { useSettingsStore } from '@/stores/settingsStore';

export async function generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
  const settings = useSettingsStore.getState();
  
  // 如果未指定模型，使用对应厂商的默认模型
  let model = request.model;
  if (!model) {
    if (request.model?.startsWith('qwen') || request.model?.startsWith('glm')) {
      model = settings.alibabaTextModel || 'qwen-plus';
    } else if (request.model?.includes('coder')) {
      model = settings.codingModel || 'qwen-coder-plus';
    } else {
      model = 'qwen-plus'; // 默认
    }
  }
  
  // 调用后端...
}
```

## UI 效果示意

```
┌─────────────────────────────────────────────────┐
│ 🔽 阿里云百炼 (Alibaba Cloud)           [API Key] │
│                                                 │
│    模型: [Qwen Plus (平衡) ▼]                    │
├─────────────────────────────────────────────────┤
│ 🔽 阿里云 Coding Plan                   [API Key] │
│                                                 │
│    模型: [Qwen Coder Plus ▼]                     │
├─────────────────────────────────────────────────┤
│ 🔽 GRSAI                                       │
│    ...                                         │
└─────────────────────────────────────────────────┘
```

## 关键文件
1. `src/features/canvas/models/providers/alibaba.ts` - 阿里云百炼模型选项
2. `src/features/canvas/models/providers/coding.ts` - Coding Plan 模型选项
3. `src/stores/settingsStore.ts` - 状态管理
4. `src/components/SettingsDialog.tsx` - 设置界面
5. `src/commands/textGen.ts` - 文本生成调用
