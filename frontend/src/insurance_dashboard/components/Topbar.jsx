import './Topbar.css'

export default function Topbar({ title, onOpenModal, onOpenDoctorModal, mdMode = false }) {
  return (
    <div className="ins-topbar">
      <div className="page-title">{title}</div>

      {!mdMode && <div className="topbar-actions">
        <button className="btn btn-primary" onClick={onOpenDoctorModal}>
          + Doctor
        </button>
        <button className="btn btn-primary" onClick={onOpenModal}>
          + Field Officer
        </button>
      </div>}
    </div>
  )
}
