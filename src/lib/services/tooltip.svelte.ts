import { TooltipState } from '@writers-ide/components';

export { TooltipState, type TooltipData } from '@writers-ide/components';

// Docking suppression and legacy UI must share this exact application instance.
const TooltipManager = new TooltipState('builtin-tooltip');
export default TooltipManager;
