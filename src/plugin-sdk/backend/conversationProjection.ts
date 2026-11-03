export { readConversationProjectId } from 'src/app-hosts/linnya/adapters/persistence/event-store/projection';
import type * as Contract from '@linnya/plugin-host-contract/backend/conversationProjection';
import * as Projection from 'src/app-hosts/linnya/adapters/persistence/event-store/projection';
const contract: typeof Contract = Projection;
void contract;
