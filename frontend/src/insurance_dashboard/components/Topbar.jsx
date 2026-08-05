import './Topbar.css'

export default function Topbar({ title, onOpenModal, onOpenDoctorModal }) {
  return (
    <div className="ins-topbar">
      <div className="page-title">{title}</div>

      <div className="topbar-actions">
        <button className="btn btn-primary" onClick={onOpenDoctorModal}>
          + Doctor
        </button>
        <button className="btn btn-primary" onClick={onOpenModal}>
          + Field Officer
        </button>
      </div>
    </div>
  )
}