import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, Building2, ZoomIn, ZoomOut, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface Designation {
  title: string;
  grade: string;
  level: number;
}

interface Department {
  name: string;
}

interface OrgNode {
  id: number;
  empCode: string;
  firstName: string;
  lastName: string;
  photo: string | null;
  designation: Designation;
  department: Department;
  children: OrgNode[];
}

interface OrgChartData {
  tree: OrgNode[];
  totalEmployees: number;
}

function hashDepartment(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}

function hashDepartmentBg(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 60%, 95%)`;
}

function NodeCard({
  node,
  collapsedIds,
  onToggle,
}: {
  node: OrgNode;
  collapsedIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isCollapsed = collapsedIds.has(node.id);
  const deptColor = hashDepartment(node.department.name);
  const deptBg = hashDepartmentBg(node.department.name);
  const initials = `${node.firstName[0] || ''}${node.lastName[0] || ''}`.toUpperCase();

  return (
    <li className="org-branch">
      <div
        className="org-node"
        style={{ borderLeftColor: deptColor }}
        onClick={() => hasChildren && onToggle(node.id)}
      >
        <div className="org-node-dept-badge" style={{ background: deptBg, color: deptColor }}>
          {node.department.name}
        </div>
        <div className="org-node-body">
          <div
            className="org-node-avatar"
            style={{ background: deptColor }}
          >
            {node.photo ? (
              <img src={node.photo} alt={node.firstName} className="org-node-photo" />
            ) : (
              <span className="org-node-initials">{initials}</span>
            )}
          </div>
          <div className="org-node-info">
            <div className="org-node-name">
              {node.firstName} {node.lastName}
            </div>
            <div className="org-node-designation">{node.designation.title}</div>
            {node.designation.grade && (
              <div className="org-node-grade">{node.designation.grade}</div>
            )}
          </div>
        </div>
        {hasChildren && (
          <div className="org-node-toggle" style={{ color: deptColor }}>
            {isCollapsed ? (
              <>
                <ChevronRight size={14} />
                <span className="org-node-count">{node.children.length}</span>
              </>
            ) : (
              <ChevronDown size={14} />
            )}
          </div>
        )}
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="org-children">
          {node.children.map((child) => (
            <NodeCard
              key={child.id}
              node={child}
              collapsedIds={collapsedIds}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgChart() {
  useAuth();
  const [data, setData] = useState<OrgChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    api
      .get('/employees/org-chart')
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load org chart'))
      .finally(() => setLoading(false));
  }, []);

  const onToggle = useCallback((id: number) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const departmentCount = useMemo(() => {
    if (!data) return 0;
    const depts = new Set<string>();
    function walk(nodes: OrgNode[]) {
      for (const n of nodes) {
        depts.add(n.department.name);
        if (n.children) walk(n.children);
      }
    }
    walk(data.tree);
    return depts.size;
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="animate-spin text-gray-400" size={36} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-medium mb-2">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-blue-600 hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        .org-tree-wrapper {
          overflow: auto;
          padding: 2rem;
          min-height: 400px;
        }
        .org-tree {
          display: flex;
          flex-direction: column;
          align-items: center;
          transform-origin: top center;
          padding-bottom: 4rem;
        }
        .org-tree > .org-branch {
          list-style: none;
        }
        .org-tree ul {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .org-children {
          display: flex;
          justify-content: center;
          padding-top: 24px;
          position: relative;
        }
        .org-children::before {
          content: '';
          position: absolute;
          top: 0;
          left: 50%;
          width: 0;
          height: 24px;
          border-left: 2px solid #cbd5e1;
        }
        .org-branch {
          display: flex;
          flex-direction: column;
          align-items: center;
          position: relative;
        }
        .org-children > .org-branch {
          padding: 24px 12px 0;
        }
        .org-children > .org-branch::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 0;
          border-top: 2px solid #cbd5e1;
        }
        .org-children > .org-branch:first-child::before {
          left: 50%;
        }
        .org-children > .org-branch:last-child::before {
          right: 50%;
        }
        .org-children > .org-branch:only-child::before {
          display: none;
        }
        .org-children > .org-branch::after {
          content: '';
          position: absolute;
          top: 0;
          left: 50%;
          width: 0;
          height: 24px;
          border-left: 2px solid #cbd5e1;
        }
        .org-node {
          width: 180px;
          background: #fff;
          border-radius: 10px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04);
          border-left: 3px solid #94a3b8;
          cursor: pointer;
          transition: box-shadow 0.15s, transform 0.15s;
          position: relative;
          overflow: hidden;
        }
        .org-node:hover {
          box-shadow: 0 2px 8px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08);
          transform: translateY(-1px);
        }
        .org-node-dept-badge {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 3px 8px;
          text-align: center;
          line-height: 1.3;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .org-node-body {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
        }
        .org-node-avatar {
          width: 36px;
          height: 36px;
          min-width: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          overflow: hidden;
        }
        .org-node-photo {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .org-node-initials {
          line-height: 1;
        }
        .org-node-info {
          min-width: 0;
          flex: 1;
        }
        .org-node-name {
          font-size: 13px;
          font-weight: 600;
          color: #1e293b;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .org-node-designation {
          font-size: 11px;
          color: #64748b;
          line-height: 1.3;
          margin-top: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .org-node-grade {
          font-size: 10px;
          color: #94a3b8;
          margin-top: 1px;
        }
        .org-node-toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 3px 0 5px;
          font-size: 11px;
          font-weight: 600;
        }
        .org-node-count {
          font-size: 10px;
          opacity: 0.8;
        }
        @media print {
          .org-controls { display: none !important; }
          .org-tree-wrapper { overflow: visible; }
          .org-tree { transform: scale(0.6) !important; transform-origin: top left; }
        }
      `}</style>

      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Organization Chart</h1>
            <p className="text-sm text-gray-500 mt-0.5">Reporting structure and hierarchy</p>
          </div>
        </div>

        {/* Summary bar */}
        <div className="flex items-center gap-6 bg-white rounded-lg border border-gray-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-blue-600" />
            <span className="text-sm text-gray-600">Total Employees</span>
            <span className="text-lg font-bold text-gray-900">{data?.totalEmployees ?? 0}</span>
          </div>
          <div className="w-px h-6 bg-gray-200" />
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-emerald-600" />
            <span className="text-sm text-gray-600">Departments</span>
            <span className="text-lg font-bold text-gray-900">{departmentCount}</span>
          </div>
          <div className="flex-1" />
          <div className="org-controls flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
              className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600"
              title="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <span className="text-xs text-gray-500 w-12 text-center font-mono">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-600"
              title="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
            <button
              onClick={() => setZoom(1)}
              className="ml-1 px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-xs text-gray-500"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Tree */}
        <div className="bg-white rounded-lg border border-gray-200 org-tree-wrapper">
          <div className="org-tree" style={{ transform: `scale(${zoom})` }}>
            <ul style={{ padding: 0, margin: 0 }}>
              {data?.tree.map((root) => (
                <NodeCard
                  key={root.id}
                  node={root}
                  collapsedIds={collapsedIds}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
