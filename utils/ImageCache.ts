import { Document } from 'mongoose'
import Api from '../modules/api'

export default class ImageCache {
  constructor (private readonly api: Api) {}

  async saveCached (element: Document | null, bot = true): Promise<Document<any, {}> | null> {
    if (element != null) {
      try {
        const method = bot ? 'getBot' : 'getUser'
        await this.api[method](element.id)
      } catch {
        return element
      }
    }
    return element
  }
}
