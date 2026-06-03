import { useApp } from '../app/AppProvider.jsx';
import { C } from '../lib/constants.js';
import { Card, PageHeader } from '../ui/components.jsx';
import { TABLES } from '../lib/constants.js';

// Phase 1 dashboard = simple live counts. Full KPIs/charts arrive in Phase 5.
export default function Dashboard() {
  const { t, data } = useApp();
  const active = (arr) => (arr || []).filter((r) => r.isActive !== false).length;

  const tiles = [
    { label: t('categories'), value: active(data[TABLES.categories]), icon: '🗂️' },
    { label: t('products'), value: active(data[TABLES.products]), icon: '📦' },
    { label: t('variants'), value: active(data[TABLES.variants]), icon: '🏷️' },
    { label: t('suppliers'), value: active(data[TABLES.suppliers]), icon: '🚚' },
  ];

  return (
    <div>
      <PageHeader title={t('dashboard')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <div style={{ fontSize: 24 }}>{tile.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: C.primary, marginTop: 4 }}>{tile.value}</div>
            <div style={{ fontSize: 12, color: C.textMuted }}>{tile.label}</div>
          </Card>
        ))}
      </div>
      <Card style={{ marginTop: 16, color: C.textMuted, fontSize: 13 }}>
        Phase 1 active: Categories, Products, Variants, Suppliers, Settings. Sales/profit KPIs and charts arrive in Phase 5.
      </Card>
    </div>
  );
}
