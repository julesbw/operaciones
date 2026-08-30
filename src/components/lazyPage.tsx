import {
  lazy,
  type ComponentType,
  type ReactNode,
} from 'react'

type LazyPageComponent = (props: never) => ReactNode

export function lazyNamedPage<
  Name extends string,
  Module extends Record<Name, LazyPageComponent>,
>(
  loader: () => Promise<Module>,
  exportName: Name,
): Module[Name] {
  const lazyComponent = lazy(async () => {
    const module = await loader()
    return {
      default: module[exportName] as unknown as ComponentType<any>,
    }
  })

  return lazyComponent as unknown as Module[Name]
}
