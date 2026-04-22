/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hook to manage CLI setup wizard visibility.
 * Checks CLI status on launch and supports opening from settings.
 */

import { useCallback, useState } from 'react';
import { ipcBridge } from '@/common';

type WizardInitialStep = 'installing' | 'setup';

export function useCliSetupWizard() {
  const [wizardVisible, setWizardVisible] = useState(false);
  const [initialStep, setInitialStep] = useState<WizardInitialStep>('installing');
  // The auto-popup that ran the online installer (curl … | bash) on every
  // launch when the `godseye` CLI was missing has been removed. CLI setup is
  // now strictly opt-in via the "Run Setup" button in Settings → System.
  const [checked] = useState(true);

  const closeWizard = useCallback(() => {
    setWizardVisible(false);
  }, []);

  /** Open wizard from settings — skip to configure step if CLI is already installed */
  const openWizard = useCallback(async () => {
    try {
      const result = await ipcBridge.cliInstaller.checkInstalled.invoke();
      if (result?.data?.installed) {
        setInitialStep('setup');
      } else {
        setInitialStep('installing');
      }
    } catch {
      setInitialStep('installing');
    }
    setWizardVisible(true);
  }, []);

  return {
    wizardVisible,
    closeWizard,
    openWizard,
    initialStep,
    checked,
  };
}
