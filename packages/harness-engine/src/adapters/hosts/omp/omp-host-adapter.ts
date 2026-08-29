import type { ControlPlaneFacade } from '../../../application/control-plane-port.ts';
import { ControlPlaneHostAdapter } from '../control-plane-host-adapter.ts';

export class OmpHostAdapter extends ControlPlaneHostAdapter {
  public constructor(facade: ControlPlaneFacade, revisionId: string) {
    super(facade, revisionId, 'omp');
  }
}
