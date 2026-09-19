/**
 * Entry point.
 *
 * Two constraints from the build, both enforced in `vite.config.ts`:
 *  - This code is wrapped in an IIFE and concatenated ahead of the frozen UI
 *    bundle, which declares its own top-level names. So nothing here may reach
 *    module top-level scope in the output.
 *  - No top-level `await`. Boot is lazy: publishing the bridge is synchronous
 *    and the UI drives the actual initialisation by calling `ready()`.
 */

import { VERSION } from './core/constants';
import { dbg } from './core/debug';
import { installNativeBridge } from './bridge/native';
import { installUiContractGlobals } from './bridge/ui-globals';
import { installSettingsUx } from './settings-ux/mount';

installUiContractGlobals();
installSettingsUx();
installNativeBridge();
dbg('boot.loaded', { message: VERSION });
