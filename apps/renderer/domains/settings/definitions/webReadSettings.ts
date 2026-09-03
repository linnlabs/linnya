import type {
  WebReadCredentialReaderId,
} from '../../../../../src/tools/web/webread/definitions/webReadConfig';
import type { SettingsMessageKey } from './settingsMessages';

export interface WebReadReaderPresentation {
  readonly id: WebReadCredentialReaderId;
  readonly nameKey: SettingsMessageKey;
  readonly descriptionKey: SettingsMessageKey;
  readonly apiKeyUrl?: string;
}

export const WEB_READ_READER_PRESENTATIONS: readonly WebReadReaderPresentation[] = [
  {
    id: 'metaso_reader',
    nameKey: 'settings.webRead.reader.metaso.name',
    descriptionKey: 'settings.webRead.reader.metaso.description',
    apiKeyUrl: 'https://metaso.cn/api/',
  },
  {
    id: 'jina_reader',
    nameKey: 'settings.webRead.reader.jina.name',
    descriptionKey: 'settings.webRead.reader.jina.description',
    apiKeyUrl: 'https://jina.ai/api-dashboard/',
  },
];
