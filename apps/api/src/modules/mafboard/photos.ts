import { storeImageBuffer, type StoreImageResult } from '../../lib/imageStore.js'

/** Хранилище фото игроков: в проде — MinIO Titan HUB (раздаётся через /media/), в тестах — память. */
export interface PhotoStore {
  store(buffer: Buffer): Promise<StoreImageResult>
}

export const minioPhotos: PhotoStore = {
  store: (buffer) => storeImageBuffer(buffer, 'mafboard-player'),
}
