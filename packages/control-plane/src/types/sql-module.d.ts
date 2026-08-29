// Bun 在编译时把带 text 属性的 *.sql 导入解析为字符串；迁移源因此能被独立可执行文件直接打包。
declare module '*.sql' {
  const contents: string;
  export default contents;
}
