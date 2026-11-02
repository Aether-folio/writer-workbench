/**
 * 极小的工具定义构造器。
 *
 * 不 import @deepseek-ai/dsh-tools：宿主工具定义本来就是 `{name, description,
 * parameters(JSON Schema), output:{schema,render}, execute}` 这个对象，直接
 * 构造即可。这样适配层可以放在作品目录里以 link: 方式安装，不必依赖 DSH
 * 安装目录内部的模块解析（link 包无法从 app.asar 里解析 peer 包）。
 */
export function tool({name, description, parameters, output, execute}) {
  if (typeof name !== 'string' || name === '') throw new Error('工具必须有 name。');
  if (typeof execute !== 'function') throw new Error(`工具 ${name} 必须有 execute。`);
  if (output === undefined || typeof output.render !== 'function') {
    throw new Error(`工具 ${name} 必须声明 output.render。`);
  }
  return {
    name,
    description,
    parameters: parameters ?? {type: 'object', properties: {}, additionalProperties: false},
    output: {
      schema: output.schema,
      render: (args, value) => output.render(args, value),
    },
    async execute(args, exec) {
      return await execute(args ?? {}, exec);
    },
  };
}
