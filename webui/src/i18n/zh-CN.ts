/*
 * Copyright (C) 2026 Vegetable
 *
 * This file is part of Evolving Coding Harness.
 *
 * Evolving Coding Harness is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Evolving Coding Harness is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Evolving Coding Harness. If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Dictionary } from "./en.js";

/** The `typeof en` annotation makes a missing key a compile error. */
export const zhCN: Dictionary = {
  "app.title": "Harness 实验仪表盘",
  "nav.runs": "实验",
  "nav.artifacts": "产物",
  "language.label": "语言",

  "runs.loading": "正在加载实验列表…",
  "runs.empty": "还没有实验记录。启动一个实验后，列表会自动刷新。",
  "runs.column.run": "实验",
  "runs.column.status": "状态",
  "runs.column.events": "事件数",
  "runs.column.started": "开始时间",
  "runs.column.last": "最近事件",

  "status.running": "进行中",
  "status.completed": "已完成",
  "status.error": "出错",
  "status.stalled": "已停滞",
  "status.active": "活跃",
  "status.dormant": "休眠",
  "status.dead": "已消亡",
  "status.other": "其他",

  "detail.back": "← 返回列表",
  "detail.events": "事件数",
  "detail.agents": "Agent 数",
  "detail.initialEnergy": "初始能量",
  "detail.agentsHeading": "Agents",
  "detail.noAgents": "该实验没有记录任何 agent。",
  "detail.energyLabel": "能量",
  "detail.energyUnavailable": "不可用",
  "detail.streamHeading": "事件流",
  "detail.liveEvents": "{count} 条实时事件（保留最近 500 条）",
  "detail.filterType": "类型",
  "detail.filterAll": "全部",
  "detail.failed": "加载失败：{message}",

  "events.column.time": "时间",
  "events.column.type": "类型",
  "events.column.agent": "Agent",
  "events.column.detail": "详情",

  "generations.heading": "代际进度",
  "generations.summary": "已启动 {started} 代，完成 {completed} 代",

  "repair.heading": "修复进度",
  "repair.taskLabel": "任务",
  "repair.taskUnknown": "未知",
  "repair.turnCount": "第 {turn} 轮",
  "repair.turnProgress": "第 {turn} / {max} 轮",
  "repair.acceptance": "独立验收：",
  "repair.passed": "通过",
  "repair.failed": "未通过",
  "repair.error": "错误：",

  "artifacts.heading": "产物",
  "artifacts.loading": "正在加载产物…",
  "artifacts.empty": "暂无产物记录。",
};
