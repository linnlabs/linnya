/**
 * @file uniqueWorkspaceNodeName.ts
 * @description Workspace 节点同父级唯一命名规则。
 */

export interface WorkspaceNodeNamePeer {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
}

export interface WorkspaceNodeRenamePlan {
  readonly nodeId: string;
  readonly oldName: string;
  readonly newName: string;
}

function splitNameExtension(name: string): { readonly stem: string; readonly extension: string } {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return { stem: name, extension: '' };
  }
  return {
    stem: name.slice(0, dotIndex),
    extension: name.slice(dotIndex),
  };
}

function buildNumberedName(name: string, index: number): string {
  const { stem, extension } = splitNameExtension(name);
  return `${stem} (${index})${extension}`;
}

/**
 * 为同一父目录生成不冲突的节点名。
 *
 * 中文说明：
 * - 这里只处理“业务命名规则”，不负责空名、路径分隔符等输入校验；
 * - 调用方必须先完成名称合法性校验，避免把脏输入悄悄修成另一个名字。
 */
export function createUniqueWorkspaceNodeName(params: {
  readonly desiredName: string;
  readonly existingNames: Iterable<string>;
}): string {
  const usedNames = new Set(params.existingNames);
  if (!usedNames.has(params.desiredName)) {
    return params.desiredName;
  }

  let index = 1;
  while (usedNames.has(buildNumberedName(params.desiredName, index))) {
    index += 1;
  }
  return buildNumberedName(params.desiredName, index);
}

export function createUniqueWorkspaceNodeCopyName(params: {
  readonly sourceName: string;
  readonly existingNames: Iterable<string>;
}): string {
  const { stem, extension } = splitNameExtension(params.sourceName);
  return createUniqueWorkspaceNodeName({
    desiredName: `${stem} 副本${extension}`,
    existingNames: params.existingNames,
  });
}

/**
 * 针对同一父目录内的历史节点生成稳定的去重改名计划。
 */
export function buildWorkspaceNodeDeduplicationPlan(
  peers: readonly WorkspaceNodeNamePeer[]
): WorkspaceNodeRenamePlan[] {
  const comparePeer = (a: WorkspaceNodeNamePeer, b: WorkspaceNodeNamePeer): number => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  };

  const peersByName = new Map<string, WorkspaceNodeNamePeer[]>();
  for (const peer of peers) {
    const group = peersByName.get(peer.name);
    if (group) {
      group.push(peer);
    } else {
      peersByName.set(peer.name, [peer]);
    }
  }

  const usedNames = new Set<string>();
  const duplicatePeers: WorkspaceNodeNamePeer[] = [];

  for (const group of peersByName.values()) {
    const sortedGroup = [...group].sort(comparePeer);
    const preservedPeer = sortedGroup[0];
    if (!preservedPeer) continue;

    // 中文说明：历史迁移必须保留每个“已有原名”的最早节点。
    // 否则已经存在的 `A (1).md` 可能被误改成 `A (1) (1).md`，
    // 反而制造更难读的路径。
    usedNames.add(preservedPeer.name);
    duplicatePeers.push(...sortedGroup.slice(1));
  }

  const renames: WorkspaceNodeRenamePlan[] = [];

  for (const peer of duplicatePeers.sort(comparePeer)) {
    const uniqueName = createUniqueWorkspaceNodeName({
      desiredName: peer.name,
      existingNames: usedNames,
    });
    usedNames.add(uniqueName);

    renames.push({
      nodeId: peer.id,
      oldName: peer.name,
      newName: uniqueName,
    });
  }

  return renames;
}
