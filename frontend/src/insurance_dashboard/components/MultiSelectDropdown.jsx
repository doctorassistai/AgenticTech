import { useState, useRef, useEffect } from "react";

export default function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleItem = (item) => {
    if (selected.includes(item)) {
      onChange(selected.filter((i) => i !== item));
    } else {
      onChange([...selected, item]);
    }
  };

  return (
    <div
      className={`field msd ${open ? "msd-open" : ""}`}
      ref={ref}
      style={{ position: "relative" }}
    >
      <label>{label}</label>

      {/* Trigger */}
      <div className="msd-trigger" onClick={() => setOpen(!open)}>
        {selected.length > 0 ? (
          selected.length > 2
            ? `${selected.length} selected`
            : selected.join(", ")
        ) : (
          <span className="msd-placeholder">Select investigators</span>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="msd-menu">
          {options.map((item) => (
            <label key={item} className="msd-item">
              <input
                type="checkbox"
                checked={selected.includes(item)}
                onChange={() => toggleItem(item)}
              />
              <span>{item}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}