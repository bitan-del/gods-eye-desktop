/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import BrainModalContent from '@/renderer/components/settings/SettingsModal/contents/BrainModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

/**
 * Full-page Brain settings — wraps the same BrainModalContent used in the
 * settings modal so both views stay in sync.
 */
const BrainSettings: React.FC = () => {
  return (
    <SettingsPageWrapper>
      <BrainModalContent />
    </SettingsPageWrapper>
  );
};

export default BrainSettings;
