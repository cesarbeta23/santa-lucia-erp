import { C, Empty, SectionHeader, Btn } from '../components/UI.jsx'

export default function Facturacion({ dbData, user, toast, reload }) {
  return (
    <div>
      <SectionHeader title="Facturacion">
        <Btn variant="primary" onClick={() => toast('Próximamente', 'info')}>
          + Nuevo
        </Btn>
      </SectionHeader>
      <Empty
        icon="🚧"
        title="Módulo en construcción"
        desc="Este módulo está siendo desarrollado. Estará disponible pronto."
      />
    </div>
  )
}
