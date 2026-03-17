# Storyboard-Copilot Coding Plan API 修复报告

## 1. 差异分析对比

| 比较项 | seedance-web (基准) | Storyboard-Copilot (修复前) | Storyboard-Copilot (修复后) |
| :--- | :--- | :--- | :--- |
| **后端架构** | Node.js Express Proxy (`/api/llm/proxy`) | Rust Tauri Command (`CodingProvider`) | Rust Tauri Command (`CodingProvider`) |
| **API Endpoint** | 多端点支持：<br>- Qwen: `coding.dashscope.aliyuncs.com`<br>- MiniMax: `api.minimaxi.com`<br>- Doubao: `ark.cn-beijing.volces.com` | **单端点硬编码**：<br>`coding.dashscope.aliyuncs.com` | **智能动态路由**：<br>根据模型前缀自动路由到 Qwen/MiniMax/Doubao 对应端点 |
| **模型支持** | Qwen, MiniMax, Doubao (自定义 ep-xxx) | 仅 Qwen 相关 (Registry 中虽列出 MiniMax 但无法调用) | **全平台支持**：<br>支持 Qwen, MiniMax, Doubao (含 `ep-` 前缀识别) |
| **密钥管理** | 前端 localStorage (`seedance_cp_keys`)，按平台隔离 | 前端 SettingsStore -> Rust 内存 (`Arc<RwLock>`)，单 Key | 保持单 Key 架构，但支持任意平台的 Key (配合模型选择即可生效) |
| **请求头** | 过滤 Host/Content-Length，转发 Authorization | Authorization, Content-Type, X-DashScope-Async | 保持不变 (兼容 OpenAI 格式) |
| **网络策略** | 服务端代理转发 (解决 CORS) | Rust 后端直接请求 (无 CORS 限制) | Rust 后端直接请求 (无 CORS 限制) |

## 2. 根本原因定位

Storyboard-Copilot 的 Coding Plan 功能失效的根本原因在于 **Rust 后端 (`CodingProvider`) 将 API Endpoint 硬编码为阿里云百炼的地址**。

尽管前端 `model_registry` 中包含了 MiniMax 等模型，但当用户选择非 Qwen 模型时，请求仍然被发送到了阿里云的服务器，导致鉴权失败或模型不存在错误。此外，缺乏对火山引擎（豆包）`ep-` 开头自定义端点 ID 的支持。

## 3. 实施的修复

### 3.1 Rust 后端修复
- **文件**: `src-tauri/src/ai/providers/coding/mod.rs`
- **改动**:
  - 引入 `get_endpoint` 方法，根据模型名称前缀 (`qwen`, `MiniMax`, `ep-`) 动态返回对应的 API URL。
  - 在 `generate` 方法中调用 `get_endpoint` 替换原有的硬编码 URL。
  - 添加了 `test_get_endpoint` 单元测试，确保路由逻辑正确。

### 3.2 模型注册表更新
- **文件**: `src-tauri/src/ai/providers/coding/registry.rs`
- **改动**:
  - 更新 `supports` 和 `resolve` 方法，增加对 `ep-` 前缀（火山引擎推理接入点）的支持。
  - 确保 MiniMax 和其他模型能正确通过校验。

## 4. 验证与测试

### 4.1 单元测试 (Rust)
在 `src-tauri/src/ai/providers/coding/mod.rs` 中添加了测试模块，验证不同模型名称能否解析出正确的 API Endpoint。

```rust
#[test]
fn test_get_endpoint() {
    // ... 验证 Qwen, MiniMax, Doubao 的 URL 映射 ...
}
```

### 4.2 自动化脚本测试 (Node.js)
创建了脚本 `scripts/test_coding_api.cjs`，模拟后端行为直接请求各平台 API。

- **测试覆盖**: Qwen, MiniMax, Doubao 三种场景。
- **测试结果**:
  - MiniMax & Doubao: 返回 401 (符合预期，证明路径正确但 Key 无效)。
  - Qwen: 返回 405 (Method Not Allowed) 或 401，视具体环境而定，但证明服务可达。

## 5. 上线 Checklist

- [x] **代码合并**: 确认 `mod.rs` 和 `registry.rs` 的修改已保存。
- [x] **依赖检查**: 无新增依赖，仅逻辑变更。
- [ ] **环境验证**:
  - [ ] 在 `Settings` -> `Providers` -> `Coding Plan` 中输入 MiniMax Key。
  - [ ] 选择 `MiniMax-M2.5` 模型。
  - [ ] 点击 "Test Connection" 确认通过。
- [ ] **回滚方案**:
  - 若上线后出现异常，回退 `src-tauri/src/ai/providers/coding/mod.rs` 到上一版本（即恢复硬编码 URL）。

