import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../public/teaching-content/首页.html", import.meta.url);
let html = readFileSync(path, "utf8");

const overview = '{key:"overview",idx:"01",cn:"总览面板",en:"Overview",desc:"两个旋钮（价格、时间）+ 三栏聚焦；用同一记上涨，看懂弹簧床与放大器的差别。",span:"1 / 4"},';
if (html.includes(overview)) html = html.replace(overview, "");
html = html
  .replace('{key:"expiration",idx:"05",cn:"到期热力图",en:"Expiration Heatmap",desc:"价格 × 期限 的二维热力图；换个到期日，墙的位置会整体搬家。",span:"4 / 7"', '{key:"expiration",idx:"05",cn:"到期热力图",en:"Expiration Heatmap",desc:"价格 × 期限 的二维热力图；换个到期日，墙的位置会整体搬家。",span:"1 / 5"')
  .replace('{key:"intraday",idx:"06",cn:"日内变化",en:"Intraday",desc:"曲线不是预测而是记录；成交热闹，不等于仓位真的变多。",span:"7 / 10"', '{key:"intraday",idx:"06",cn:"日内变化",en:"Intraday",desc:"曲线不是预测而是记录；成交热闹，不等于仓位真的变多。",span:"5 / 9"')
  .replace('{key:"volatility",idx:"07",cn:"波动率微笑 / 偏斜",en:"Volatility Smile & Skew",desc:"一条微笑两层读懂：形状来自需求，位置来自风险；偏斜方向说明谁在买保险。",span:"10 / 13"', '{key:"volatility",idx:"07",cn:"波动率微笑 / 偏斜",en:"Volatility Smile & Skew",desc:"一条微笑两层读懂：形状来自需求，位置来自风险；偏斜方向说明谁在买保险。",span:"9 / 13"');

if (html.includes('key:"overview"') || !html.includes('key:"expiration",idx:"05"')) {
  throw new Error("教学首页课程数组补丁未正确应用");
}
writeFileSync(path, html);
