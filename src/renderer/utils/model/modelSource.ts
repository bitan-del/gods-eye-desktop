/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpModelInfo } from '@/common/types/acpTypes';

/**
 * 获取模型来源标签，用于界面直接显示。
 */
export function getAcpModelSourceLabel(modelInfo: Pick<AcpModelInfo, 'source' | 'sourceDetail'> | null): string {
  const sourceDetail = modelInfo?.sourceDetail;
  if (sourceDetail === 'cc-switch') return 'cc-switch';
  if (sourceDetail === 'acp-config-option') return 'Gods Eye';
  if (sourceDetail === 'acp-models') return 'Gods Eye';
  if (sourceDetail === 'persisted-model') return 'saved model';
  if (sourceDetail === 'codex-stream') return 'Codex stream';

  if (modelInfo?.source === 'configOption') return 'Gods Eye';
  if (modelInfo?.source === 'models') return 'Gods Eye';
  return '';
}

/**
 * 组合模型显示文本，附带来源标签。
 */
export function formatAcpModelDisplayLabel(modelLabel: string, sourceLabel: string): string {
  if (!sourceLabel) return modelLabel;
  if (!modelLabel) return sourceLabel;
  return `${modelLabel} · ${sourceLabel}`;
}
