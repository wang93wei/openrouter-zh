# OpenRouter 中文化脚本

这是一个给 `openrouter.ai` 使用的 Tampermonkey 用户脚本，目标是把站点界面、文档导航和常见说明文字尽量翻译成中文。

现在的实现使用 Tampermonkey 的 `@resource` 机制直接引入本地翻译文件；如果本地资源未成功加载，脚本会自动回退到内置默认词库。

脚本会自动监听页面的 DOM 变化，因此对 OpenRouter 这种 SPA 页面切换也能持续生效。

## 文件

- `openrouter-zh.user.js`：可直接导入 Tampermonkey 的用户脚本
- `translations/openrouter-zh.json`：本地翻译词库，脚本通过 `@resource` 直接读取它

## 安装

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)
2. 新建脚本
3. 将 [`openrouter-zh.user.js`](/Users/alanwang/git/openrouter-zh/openrouter-zh.user.js) 的内容粘贴进去并保存
4. 打开 `https://openrouter.ai/`
5. 确认脚本头部存在这一行本地资源引用：

```js
// @resource     openrouterZhTranslations file:///Users/alanwang/git/openrouter-zh/translations/openrouter-zh.json
```

6. 如果本地词库没有生效，请在 Tampermonkey 设置页开启：
   `通用 -> 配置模式 -> 高级`
   `安全 -> 允许脚本访问本地文件 -> 外部(@require 和 @resource)`

## 已实现特性

- 支持 `https://openrouter.ai/*`
- 支持首页、文档页、模型页等常见页面
- 支持 React / SPA 动态更新
- 尽量跳过代码块、编辑器、模型 ID、命令行片段
- 支持本地 `JSON` 词库引入
- 本地词库加载失败时自动回退到内置词库
- 支持 Tampermonkey 菜单：
  - 开启/关闭中文化
  - 重新加载本地词库并翻译当前页

## 词库格式

词库文件使用以下结构：

```json
{
  "navigation": {
    "Search": "搜索"
  },
  "docs": {
    "Documentation": "文档"
  },
  "marketing": {
    "Community": "社区"
  },
  "static": {
    "Extra Text": "额外词条"
  },
  "regexRules": [
    {
      "pattern": "^View docs$",
      "flags": "i",
      "replacement": "查看文档"
    }
  ]
}
```

说明：

- `navigation`、`docs`、`marketing`：只是为了方便分类维护，运行时会自动合并
- `static`：额外静态词条，适合放不想分组的零散文案
- `regexRules`：动态文案规则，`pattern` 写正则源码，不要带两侧 `/`

## 维护方式

- 常规维护直接修改 [`translations/openrouter-zh.json`](/Users/alanwang/git/openrouter-zh/translations/openrouter-zh.json)
- 修改本地词库后，刷新页面或点击“重新加载本地词库并翻译当前页”
- 如果你把仓库放到别的路径，需要同步修改 [`openrouter-zh.user.js`](/Users/alanwang/git/openrouter-zh/openrouter-zh.user.js) 头部的 `@resource file:///...` 路径

## 说明

- 这是手工维护词库的版本，不依赖在线翻译接口
- 某些非常动态、非常碎片化或本身就是代码示例的内容，会被有意跳过，以避免误翻译
