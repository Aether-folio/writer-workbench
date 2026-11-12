import test from 'node:test';
import assert from 'node:assert/strict';
import {fileTree,documentHeadings} from '../src/sidebar.mjs';

test('文件树保留嵌套路径，文件夹优先，章节数字自然排序',()=>{
  const tree=fileTree(['文稿/第10章.md','文稿/第2章.md','文稿/卷一/第1章.txt','说明.md'].map(path=>({path})));
  assert.equal(tree[0].name,'文稿');
  assert.deepEqual(tree[0].children.map(node=>node.name),['卷一','第2章.md','第10章.md']);
  assert.equal(tree[0].children[0].children[0].path,'文稿/卷一/第1章.txt');
  assert.equal(tree[1].path,'说明.md');
  assert.deepEqual(fileTree([]),[]);
});

test('中文章号按数值排序，复现第二章、第三章、第一章的错误顺序',()=>{
  const files=['第二章.md','第三章.md','第一章.md'].map(name=>({path:'正文/'+name}));
  assert.deepEqual(fileTree(files)[0].children.map(node=>node.name),['第一章.md','第二章.md','第三章.md']);
});

test('中文章号跨十百千万排序，并可混用阿拉伯数字和中文数字',()=>{
  const expected=['第一章.md','第2章.md','第三章.md','第九章.md','第十章.md','第十一章.md','第20章.md','第二十一章.md','第九十九章.md','第一百章.md','第一百零一章.md','第两百章.md','第九百九十九章.md','第一千章.md','第一千零一章.md','第九千九百九十九章.md','第一万章.md','第一万零一章.md','第一亿章.md','第一亿零二万章.md'];
  const tree=fileTree([...expected].reverse().map(name=>({path:'正文/'+name})));
  assert.deepEqual(tree[0].children.map(node=>node.name),expected);
});

test('中文卷号目录按数值排序，保留目录优先与完整文件名',()=>{
  const directories=['卷十','卷二','卷一'].map(path=>({path}));
  const files=['第十一章 夜雨.md','第二章 开始.md','第一章 初见.md','设定2.md','设定10.md'].map(path=>({path}));
  assert.deepEqual(fileTree(files,directories).map(node=>node.name),['卷一','卷二','卷十','第一章 初见.md','第二章 开始.md','第十一章 夜雨.md','设定2.md','设定10.md']);
  assert.deepEqual(fileTree(['第〇九回.txt','第十回.txt','第一〇一回.txt'].map(path=>({path}))).map(node=>node.name),['第〇九回.txt','第十回.txt','第一〇一回.txt']);
});

test('大纲识别标题层级，跳转偏移保留 CRLF 与中文字符',()=>{
  const body='# 第一章\r\n正文\r\n## 小节 ##\r\n章节标题\r\n=====\r\n';
  const headings=documentHeadings(body);
  assert.deepEqual(headings.map(({text,level})=>({text,level})),[{text:'第一章',level:1},{text:'小节',level:2},{text:'章节标题',level:1}]);
  for(const heading of headings) assert.ok(body.slice(heading.start,heading.end).includes(heading.text));
  assert.equal(headings[1].start,body.indexOf('## 小节'));
});

test('新作品与空的设定、正文、草稿文件夹无需文稿即可显示',()=>{
  const directories=['测试作品','测试作品/设定','测试作品/正文','测试作品/草稿'].map(path=>({path}));
  const tree=fileTree([],directories);
  assert.equal(tree[0].name,'测试作品');
  assert.deepEqual(tree[0].children.map(node=>node.name),['正文','草稿','设定']);
  assert.ok(tree[0].children.every(node=>node.children.length===0));
  assert.equal(fileTree([{path:'测试作品/正文/第一章.md'}],directories)[0].children.find(node=>node.name==='正文').children[0].name,'第一章.md');
});

test('代码围栏和缩进代码中的标题不进入大纲',()=>{
  const body=['# 正文','```md','# 示例','````','    ## 缩进示例','~~~','## 另一个示例','~~~','### 结尾'].join('\n');
  assert.deepEqual(documentHeadings(body).map(item=>item.text),['正文','结尾']);
});
