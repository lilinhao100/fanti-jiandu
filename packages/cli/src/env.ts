import { DOMParser as LinkedomDOMParser } from 'linkedom';
import type { TransformEnv } from '@fjd/engine';

/** linkedom 没有 XMLSerializer；它的 toString() 对 XML 文档就是 XML 序列化。 */
class ShimXMLSerializer {
  serializeToString(node: Node): string {
    return String(node);
  }
}

export const env: TransformEnv = {
  DOMParser: LinkedomDOMParser as unknown as typeof DOMParser,
  XMLSerializer: ShimXMLSerializer as unknown as typeof XMLSerializer,
};
