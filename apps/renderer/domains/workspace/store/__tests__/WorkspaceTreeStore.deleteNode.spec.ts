// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => {
    return {
        deleteNodeMock: vi.fn(),
        listNodesMock: vi.fn(),
    };
});

vi.mock('@/shared/ipc/workspaceGateway', () => {
    return {
        workspaceGateway: {
            'delete-node': mocks.deleteNodeMock,
            'list-nodes': mocks.listNodesMock,
            'list-vfs-nodes': mocks.listNodesMock,
        },
    };
});

import { useWorkspaceTreeStore } from '../WorkspaceTreeStore';

describe('WorkspaceTreeStore.deleteNode', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        mocks.deleteNodeMock.mockReset();
        mocks.listNodesMock.mockReset();
        mocks.deleteNodeMock.mockResolvedValue({ success: true, data: { deletedNodeIds: ['doc-1'] } });
        mocks.listNodesMock.mockResolvedValue({ success: true, data: [] });
    });

    it('删除节点后返回后端确认的完整删除 ID', async () => {
        const store = useWorkspaceTreeStore();
        store.projectTree = [
            {
                id: 'proj-1',
                name: 'P',
                type: 'project',
                projectId: 'proj-1',
                parentId: null,
                children: [
                    {
                        id: 'doc-1',
                        name: 'D',
                        type: 'sheet',
                        projectId: 'proj-1',
                        parentId: 'proj-1',
                        children: null,
                        isExpanded: false,
                        depth: 1,
                    },
                ],
                isExpanded: true,
                depth: 0,
            },
        ];

        const deletedNodeIds = await store.deleteNode('doc-1', 'proj-1');

        expect(deletedNodeIds).toEqual(['doc-1']);
        expect(mocks.deleteNodeMock).toHaveBeenCalledWith({ nodeId: 'doc-1' });
    });

    it('删除文件夹时透传后端确认的子树 ID', async () => {
        const store = useWorkspaceTreeStore();
        store.projectTree = [
            {
                id: 'proj-1',
                name: 'P',
                type: 'project',
                projectId: 'proj-1',
                parentId: null,
                children: [
                    {
                        id: 'folder-1',
                        name: 'F',
                        type: 'folder',
                        projectId: 'proj-1',
                        parentId: 'proj-1',
                        children: [
                            {
                                id: 'doc-1',
                                name: 'D',
                                type: 'sheet',
                                projectId: 'proj-1',
                                parentId: 'folder-1',
                                children: null,
                                isExpanded: false,
                                depth: 2,
                            },
                        ],
                        isExpanded: true,
                        depth: 1,
                    },
                ],
                isExpanded: true,
                depth: 0,
            },
        ];

        mocks.deleteNodeMock.mockResolvedValue({
            success: true,
            data: { deletedNodeIds: ['folder-1', 'doc-1'] },
        });

        const deletedNodeIds = await store.deleteNode('folder-1', 'proj-1');

        expect(deletedNodeIds).toEqual(['folder-1', 'doc-1']);
        expect(mocks.deleteNodeMock).toHaveBeenCalledWith({ nodeId: 'folder-1' });
    });

    it('删除不相关节点时只刷新对应父节点', async () => {
        const store = useWorkspaceTreeStore();
        store.projectTree = [
            {
                id: 'proj-1',
                name: 'P',
                type: 'project',
                projectId: 'proj-1',
                parentId: null,
                children: [
                    {
                        id: 'doc-1',
                        name: 'D',
                        type: 'sheet',
                        projectId: 'proj-1',
                        parentId: 'proj-1',
                        children: null,
                        isExpanded: false,
                        depth: 1,
                    },
                    {
                        id: 'doc-2',
                        name: 'D2',
                        type: 'document',
                        projectId: 'proj-1',
                        parentId: 'proj-1',
                        children: null,
                        isExpanded: false,
                        depth: 1,
                    },
                ],
                isExpanded: true,
                depth: 0,
            },
        ];

        mocks.deleteNodeMock.mockResolvedValue({ success: true, data: { deletedNodeIds: ['doc-2'] } });

        await store.deleteNode('doc-2', 'proj-1');

        expect(mocks.deleteNodeMock).toHaveBeenCalledWith({ nodeId: 'doc-2' });
    });

});
