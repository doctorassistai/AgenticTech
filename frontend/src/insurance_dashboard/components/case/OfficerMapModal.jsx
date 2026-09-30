// components/case/OfficerMapModal.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { GoogleMap, MarkerF, InfoWindowF, Autocomplete, useJsApiLoader } from '@react-google-maps/api'

const LIBRARIES = ['places']
const GOOGLE_API_KEY = 'AIzaSyA3VwLT1IQxhUeGKxKstHw-dZ2uJ4Hta7w'

const STATUS_COLOR = {
  Available:   '#22c55e',
  Unavailable: '#9ca3af',
}
const containerStyle = { width: '100%', height: '100%' }
const defaultCenter  = { lat: 20.5937, lng: 78.9629 } // India center fallback

function formatLastUpdated(iso) {
  if (!iso) return 'Unknown'
  const then = new Date(iso)
  if (isNaN(then.getTime())) return 'Unknown'

  const diffMs  = Date.now() - then.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1)   return 'Just now'
  if (diffMin < 60)  return `${diffMin} min ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24)   return `${diffHr} hr${diffHr > 1 ? 's' : ''} ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay} day${diffDay > 1 ? 's' : ''} ago`
}

const AVAILABILITY_ALL_URL = 'https://doctorassist.ai/api/insurance/app/availability/all'

export default function OfficerMapModal({ open, onClose }) {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_API_KEY,
    libraries: LIBRARIES,
  })

  const [officers, setOfficers]     = useState([])
  const [loading, setLoading]       = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]           = useState(null)
  const [hovered, setHovered]       = useState(null) // officer being hovered
  const [searchValue, setSearchValue] = useState('')
  const [mapCenter, setMapCenter]     = useState(null)
  const [mapZoom, setMapZoom]         = useState(null)

  const mapRef           = useRef(null)
  const autocompleteRef  = useRef(null)

  const onMapLoad = useCallback((map) => { mapRef.current = map }, [])

  const onAutocompleteLoad = useCallback((autocomplete) => {
    autocompleteRef.current = autocomplete
  }, [])

  const onPlaceChanged = useCallback(() => {
    const place = autocompleteRef.current?.getPlace()
    if (!place || !place.geometry || !place.geometry.location) return
    const lat = place.geometry.location.lat()
    const lng = place.geometry.location.lng()
    setMapCenter({ lat, lng })
    setMapZoom(14)
    setSearchValue(place.formatted_address || place.name || '')
    mapRef.current?.panTo({ lat, lng })
    mapRef.current?.setZoom(14)
  }, [])

  const fetchOfficers = useCallback((isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true)
    setError(null)
    return fetch(AVAILABILITY_ALL_URL, {
      headers: { 'X-User-Id': 'web-user', 'X-User-Role': 'supervisor' },
    })
      .then(r => r.json())
      .then(data => setOfficers(data.officers || []))
      .catch(() => setError('Could not load officer locations'))
      .finally(() => (isRefresh ? setRefreshing(false) : setLoading(false)))
  }, [])

  useEffect(() => {
    if (!open) return
    fetchOfficers(false)
  }, [open, fetchOfficers])

  const withCoords = officers.filter(
    o => typeof o.latitude === 'number' && typeof o.longitude === 'number'
  )

  const center = withCoords.length
    ? { lat: withCoords[0].latitude, lng: withCoords[0].longitude }
    : defaultCenter

  const handleClose = useCallback(() => {
    setHovered(null)
    onClose()
  }, [onClose])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={handleClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg1, #fff)',
          borderRadius: 14,
          width: 'min(920px, 100%)',
          height: 'min(640px, 100%)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid var(--border, #e5e7eb)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontWeight: 700, fontSize: 15 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path
                d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11z"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
              />
              <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="2" />
            </svg>
            Field Officer Locations
            <span style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, fontWeight: 500, color: 'var(--muted, #6b7280)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR.Available }} /> Available
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR.Unavailable }} /> Unavailable
              </span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => fetchOfficers(true)}
              disabled={loading || refreshing}
              title="Refresh"
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'var(--bg2, #f3f4f6)',
                border: '1px solid var(--border, #e5e7eb)',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 12, fontWeight: 600,
                color: 'var(--text, #111827)',
                cursor: (loading || refreshing) ? 'not-allowed' : 'pointer',
                opacity: (loading || refreshing) ? 0.6 : 1,
              }}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                style={{
                  animation: refreshing ? 'omm-spin 0.8s linear infinite' : 'none',
                }}
              >
                <path
                  d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"
                  stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"
                />
              </svg>
              Refresh
            </button>
            <style>{`
              @keyframes omm-spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
            `}</style>
            <button
              onClick={handleClose}
              style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--muted, #6b7280)' }}
            >×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, position: 'relative' }}>
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--muted)' }}>
              Loading officer locations…
            </div>
          )}
          {error && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#ef4444' }}>
              {error}
            </div>
          )}
          {!loading && !error && isLoaded && (
            <GoogleMap
              mapContainerStyle={containerStyle}
              center={mapCenter || center}
              zoom={mapZoom || (withCoords.length ? 10 : 5)}
              onLoad={onMapLoad}
            >
              <Autocomplete onLoad={onAutocompleteLoad} onPlaceChanged={onPlaceChanged}>
                <input
                  type="text"
                  placeholder="Search a place..."
                  value={searchValue}
                  onChange={e => setSearchValue(e.target.value)}
                  style={{
                    boxSizing: 'border-box',
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    width: 280,
                    zIndex: 10,
                    padding: '10px 14px',
                    fontSize: 13,
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    outline: 'none',
                  }}
                />
              </Autocomplete>
              {withCoords.map(o => (
                <MarkerF
                  key={o.userId}
                  position={{ lat: o.latitude, lng: o.longitude }}
                  onMouseOver={() => setHovered(o)}
                  onMouseOut={() => setHovered(null)}
                >
                  {hovered?.userId === o.userId && (
                    <InfoWindowF
                      position={{ lat: o.latitude, lng: o.longitude }}
                      onCloseClick={() => setHovered(null)}
                    >
                      <div style={{ fontSize: 12, color: '#111', minWidth: 140 }}>
                        <div style={{ fontWeight: 700 }}>{o.fullName || 'Unnamed'}</div>
                        <div style={{ color: '#6b7280' }}>{o.userId}</div>
                        <div style={{ marginTop: 4, fontWeight: 600, color: STATUS_COLOR[o.status] }}>
                          {o.status}
                        </div>
                        <div style={{ marginTop: 3, fontSize: 11, color: '#9ca3af' }}>
                          Updated {formatLastUpdated(o.lastUpdated)}
                        </div>
                      </div>
                    </InfoWindowF>
                  )}
                </MarkerF>
              ))}
            </GoogleMap>
          )}
        </div>
      </div>
    </div>
  )
}