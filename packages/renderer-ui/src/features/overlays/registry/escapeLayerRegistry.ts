/** 登记到注册表的一层；以引用区分，同一个函数登记两次是两层。 */
export interface EscapeLayerRegistration {
  readonly onEscape: (event: KeyboardEvent) => void;
}

/** 返回的函数把该层从注册表移除；重复调用无副作用。 */
export type UnregisterEscapeLayer = () => void;

export interface EscapeLayerRegistry {
  register: (layer: EscapeLayerRegistration) => UnregisterEscapeLayer;
}

const registries = new WeakMap<Document, EscapeLayerRegistry>();

function createEscapeLayerRegistry(target: Document): EscapeLayerRegistry {
  const layers: EscapeLayerRegistration[] = [];

  // 整个 document 只有这一个 Escape 监听：首层登记时安装，最后一层退出时移除。
  // 只有最后登记（最后打开）的层收到事件，所以嵌套浮层按“先关最上面一层”处理。
  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    layers[layers.length - 1]?.onEscape(event);
  }

  function register(layer: EscapeLayerRegistration): UnregisterEscapeLayer {
    layers.push(layer);
    if (layers.length === 1) target.addEventListener('keydown', handleKeyDown);

    return () => {
      const index = layers.indexOf(layer);
      if (index < 0) return;
      layers.splice(index, 1);
      if (layers.length === 0) target.removeEventListener('keydown', handleKeyDown);
    };
  }

  return { register };
}

/** 每个 document 一份注册表，Host 与插件共用同一个 renderer-ui 单例时也共用同一份顺序。 */
export function getEscapeLayerRegistry(target: Document): EscapeLayerRegistry {
  const existing = registries.get(target);
  if (existing) return existing;
  const created = createEscapeLayerRegistry(target);
  registries.set(target, created);
  return created;
}
