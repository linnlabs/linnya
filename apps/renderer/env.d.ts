/// <reference types="vite/client" />
/// <reference path="../../src/types/electron-api.d.ts" />

import 'pinia'
import { PersistedStateOptions } from 'pinia-plugin-persistedstate'

declare module 'pinia' {
  export interface DefineSetupStoreOptions<Id, S, G, A> {
    persist?: PersistedStateOptions;
  }
}
