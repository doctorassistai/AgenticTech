import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserRound ,Mic,Pause  } from 'lucide-react';


// API base URL from environment variable
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL

const PreScreeningQuestionsForm = () => {
  // Get search params from URL
  const [searchParams] = useSearchParams();
  
  // State management
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState(null);
  const [questions, setQuestions] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notification, setNotification] = useState(null);
  const [clinicId, setClinicId] = useState('');
  
  // Refs
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const questionsTextareaRef = useRef(null);
  const notificationTimeoutRef = useRef(null);

  // Extract clinic_id from URL on component mount
  useEffect(() => {
    const clinicIdFromUrl = searchParams.get('clinic_id');
    if (clinicIdFromUrl) {
      setClinicId(clinicIdFromUrl);
      console.log('Clinic ID from URL:', clinicIdFromUrl);
    } else {
      showNotification('Clinic ID not found in URL', 'error');
      console.error('No clinic_id parameter found in URL');
    }
  }, [searchParams]);

  // Show notification and auto-hide
  const showNotification = (message, type = 'info') => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    
    setNotification({ message, type });
    
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, 3000);
  };

  // Load doctors when clinicId is available
  useEffect(() => {
    if (clinicId) {
      fetchDoctors(clinicId);
    }
    
    // Cleanup
    return () => {
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
    };
  }, [clinicId]);

  // Load existing questions when doctor is selected
  useEffect(() => {
    if (selectedDoctor && selectedDoctor.sys_user_id) {
      loadExistingQuestions(selectedDoctor.sys_user_id);
    }
  }, [selectedDoctor]);

  // Fetch doctors from API using clinic_id as hospital_id
  const fetchDoctors = async (hospitalId) => {
    try {
      setIsLoading(true);
      console.log('Fetching doctors for hospital:', hospitalId);
      
      const response = await fetch(
        `${API_BASE_URL}hms/users/data/whatsapp/get_doctors_by_hospital/${hospitalId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch doctors: ${response.status}`);
      }

      const data = await response.json();
      console.log('Doctors data:', data);
      
      if (Array.isArray(data)) {
        setDoctors(data);
        if (data.length > 0) {
          setSelectedDoctor(data[0]);
        }
      } else {
        throw new Error('Invalid response format: Expected array');
      }
    } catch (error) {
      console.error('Failed to fetch doctors:', error);
      showNotification('Failed to load doctors', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Load existing screening questions for selected doctor
  const loadExistingQuestions = async (doctorId) => {
    try {
      setIsLoading(true);
      console.log('Loading questions for doctor:', doctorId);
      
      const response = await fetch(
        `${API_BASE_URL}hms/users/data/whatsapp/screening-questions/${doctorId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      
      if (response.status === 404) {
        // No questions exist yet - this is okay
        console.log('No existing questions found');
        setQuestions('');
        return;
      }
      
      if (!response.ok) {
        throw new Error(`Failed to load questions: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Existing questions data:', data);
      
      if (data?.questions && Array.isArray(data.questions)) {
        const formattedQuestions = data.questions.join('\n');
        setQuestions(formattedQuestions);
        showNotification(`${data.questions.length} existing questions loaded`, 'info');
        
        // Auto-scroll to bottom
        if (questionsTextareaRef.current) {
          setTimeout(() => {
            questionsTextareaRef.current.scrollTop = questionsTextareaRef.current.scrollHeight;
          }, 100);
        }
      } else {
        setQuestions('');
      }
    } catch (error) {
      console.error('Failed to load existing questions:', error);
      if (!error.message.includes('404')) {
        showNotification('Failed to load existing questions', 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Load pre-screening configuration
  const loadPreScreeningConfig = async (doctorId) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}hms/users/orchestration/doctor_patientprescreening_features/${doctorId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log('Pre-screening config:', data);
        
        // Find pre-screening section in features
        const preScreeningFeature = data.features?.find(
          feature => feature.feature_id === 'pre-screening-section'
        );
        
        if (preScreeningFeature?.pre_screening?.questions) {
          const configQuestions = preScreeningFeature.pre_screening.questions;
          const separator = questions ? '\n\n' : '';
          setQuestions(prev => prev + separator + configQuestions);
          showNotification('Pre-configured questions loaded', 'info');
        }
      }
    } catch (error) {
      console.error('Failed to load pre-screening config:', error);
    }
  };

  // Save screening questions
  const saveQuestions = async () => {
    if (!selectedDoctor) {
      showNotification('Please select a doctor first', 'warning');
      return;
    }

    if (!questions.trim()) {
      showNotification('Please enter some screening questions', 'warning');
      return;
    }

    try {
      setIsSaving(true);
      
      // Format questions as array
      const questionsArray = questions
        .split('\n')
        .map(q => q.trim())
        .filter(q => q.length > 0);
      
      const payload = {
        doctor_id: selectedDoctor.sys_user_id,  // Using sys_user_id as doctor_id
        questions: questionsArray
      };

      console.log('Saving questions with payload:', payload);

      const response = await fetch(
        `${API_BASE_URL}hms/users/orchestration/save_doctor_screening_questions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to save: ${response.status}`);
      }

      const data = await response.json();
      console.log('Save response:', data);
      
      showNotification('Screening questions saved successfully!', 'success');
      
      // Update doctor's configured status
      setDoctors(prevDoctors => 
        prevDoctors.map(doctor => 
          doctor.sys_user_id === selectedDoctor.sys_user_id 
            ? { ...doctor, configured: true }
            : doctor
        )
      );
    } catch (error) {
      console.error('Failed to save questions:', error);
      showNotification(`Failed to save: ${error.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Voice recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });

      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = processAudio;
      mediaRecorderRef.current.start();
      setIsRecording(true);
      showNotification('Recording started. Speak now...', 'info');
    } catch (error) {
      console.error('Microphone access denied:', error);
      showNotification('Microphone permission is required. Please allow access.', 'error');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
    }
  };

  const processAudio = async () => {
    if (audioChunksRef.current.length === 0) {
      showNotification('No audio recorded!', 'warning');
      return;
    }

    try {
      setIsProcessing(true);
      showNotification('Processing audio transcription...', 'info');

      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const formData = new FormData();
      formData.append('file', blob, 'recording.webm');

      const response = await fetch(
        `${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.status}`);
      }

      const data = await response.json();
      const transcribedText = data?.text || '';

      if (transcribedText.trim()) {
        // Append transcribed text to questions
        const separator = questions ? '\n\n' : '';
        setQuestions(prev => prev + separator + transcribedText);
        
        showNotification('Voice transcription added successfully!', 'success');
        
        // Auto-scroll to bottom
        if (questionsTextareaRef.current) {
          setTimeout(() => {
            questionsTextareaRef.current.scrollTop = questionsTextareaRef.current.scrollHeight;
          }, 100);
        }
      } else {
        showNotification('No speech detected in audio', 'warning');
      }
    } catch (error) {
      console.error('Transcription error:', error);
      showNotification('Transcription failed. Please try again.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle voice recording toggle
  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Handle keyboard shortcut (Ctrl + Space)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        if (!isProcessing && selectedDoctor) {
          toggleRecording();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRecording, isProcessing, selectedDoctor]);

  // Handle doctor selection
  const handleDoctorSelect = (doctor) => {
    setSelectedDoctor(doctor);
    // Also load pre-screening config when selecting a doctor
    loadPreScreeningConfig(doctor.sys_user_id);
  };

  // Clear all questions
  const handleClearQuestions = () => {
    setQuestions('');
    showNotification('Questions cleared', 'info');
  };

  // Notification type styles
  const notificationStyles = {
    success: 'bg-green-900/80 border-green-700 text-green-100',
    error: 'bg-red-900/80 border-red-700 text-red-100',
    warning: 'bg-yellow-900/80 border-yellow-700 text-yellow-100',
    info: 'bg-blue-900/80 border-blue-700 text-blue-100'
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4 md:p-6">
      {/* Notification Toast */}
      {notification && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-4 rounded-xl border shadow-xl animate-fadeIn ${notificationStyles[notification.type]}`}>
          <div className="flex items-center space-x-3">
            <i className={`fas ${
              notification.type === 'success' ? 'fa-check-circle text-green-300' :
              notification.type === 'error' ? 'fa-exclamation-circle text-red-300' :
              notification.type === 'warning' ? 'fa-exclamation-triangle text-yellow-300' :
              'fa-info-circle text-blue-300'
            } text-lg`}></i>
            <div className="font-medium">{notification.message}</div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Pre-Screening Questions Configuration</h1>
              <div className="flex items-center space-x-4 text-gray-400">
                <p>Configure screening questions for doctors using voice or text input</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              {isLoading && (
                <div className="flex items-center space-x-2 text-blue-400">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                  <span className="text-sm">Loading...</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Doctor Selection */}
          <div className="lg:col-span-1">
            <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white flex items-center">
                  <i className="fas fa-user-md mr-3 text-blue-400"></i>
                  Select Doctor
                </h2>
                <span className="px-2 py-1 text-xs bg-gray-700 rounded-lg">
                  {doctors.length} doctors
                </span>
              </div>
              
              {!clinicId ? (
                <div className="text-center py-8 text-gray-400">
                  <i className="fas fa-exclamation-triangle text-3xl mb-3 text-yellow-500"></i>
                  <p className="mb-2">Clinic ID not found in URL</p>
                  <p className="text-sm">Please access this page with a clinic_id parameter</p>
                </div>
              ) : isLoading ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mb-4"></div>
                  <p className="text-gray-400">Loading doctors...</p>
                </div>
              ) : doctors.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <i className="fas fa-user-md text-3xl mb-3 opacity-50"></i>
                  <p>No doctors found for this clinic</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {doctors.map((doctor) => (
                    <button
                      key={doctor.sys_user_id}
                      onClick={() => handleDoctorSelect(doctor)}
                      className={`w-full p-4 rounded-xl border text-left transition-all duration-200 ${
                        selectedDoctor?.sys_user_id === doctor.sys_user_id
                          ? 'border-blue-500 bg-blue-900/20 shadow-md'
                          : 'border-gray-700 hover:border-gray-600 hover:bg-gray-700/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h3 className="font-medium text-white">Dr. {doctor.name}</h3>
                          <p className="text-sm text-gray-400 mt-1">
                            {doctor.specialization || 'General Practitioner'}
                          </p>
                        </div>
                        {doctor.configured && (
                          <span className="px-2 py-1 text-xs bg-green-900/40 text-green-300 rounded-lg flex-shrink-0 ml-2">
                            <i className="fas fa-check mr-1"></i>
                            Configured
                          </span>
                        )}
                      </div>
                      {selectedDoctor?.sys_user_id === doctor.sys_user_id && (
                        <div className="mt-2 pt-2 border-t border-gray-700">
                          <p className="text-xs text-gray-500 truncate">
                            ID: {doctor.sys_user_id}
                          </p>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Current Doctor Info */}
            {selectedDoctor && (
              <div className="mt-6 bg-gray-800 rounded-2xl border border-gray-700 shadow-lg p-6">
                <h3 className="text-lg font-medium text-white mb-4">Selected Doctor</h3>
                <div className="space-y-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-blue-900/30 rounded-xl flex items-center justify-center">
                      <UserRound className="text-blue-400 text-xl" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-white">Dr. {selectedDoctor.name}</h4>
                      <p className="text-sm text-gray-400">{selectedDoctor.specialization || 'General'}</p>
                    </div>
                  </div>
                  
                  <div className="pt-3 border-t border-gray-700 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">ID:</span>
                      <span className="text-gray-300 font-mono text-xs truncate">
                        {selectedDoctor.sys_user_id}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Questions:</span>
                      <span className="text-gray-300">
                        {questions.split('\n').filter(line => line.trim()).length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Questions Form */}
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-2xl border border-gray-700 shadow-lg overflow-hidden">
              {/* Form Header */}
              <div className="px-6 py-5 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-blue-900/30 rounded-xl flex items-center justify-center">
                    <UserRound className="text-blue-400 text-xl" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-white">
                      Screening Questions
                    </h2>
                    <p className="text-gray-400 text-sm">
                      {selectedDoctor 
                        ? `For Dr. ${selectedDoctor.name} (${selectedDoctor.specialization || 'General'})`
                        : 'Select a doctor to begin'
                      }
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  {isRecording && (
                    <div className="flex items-center space-x-2 px-3 py-1 bg-red-900/30 rounded-lg">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                      <span className="text-sm text-red-300">Recording</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Form Content */}
              <div className="p-6">
                {/* Questions Textarea */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-medium text-gray-300">
                      Pre-Screening Questions
                    </label>
                    <div className="text-sm text-gray-500">
                      {questions.split('\n').filter(line => line.trim()).length} questions
                    </div>
                  </div>
                  
                  <div className="relative">
                    <textarea
                      ref={questionsTextareaRef}
                      value={questions}
                      onChange={(e) => setQuestions(e.target.value)}
                      rows={10}
                      className="w-full px-4 py-4 bg-gray-900 border border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none text-gray-100 placeholder-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!selectedDoctor}
                    />
                    
                    {/* Voice Recording Button */}
                    <div className="absolute bottom-4 right-4 flex items-center space-x-3">
                      {isProcessing && (
                        <div className="flex items-center space-x-2 bg-gray-800/90 px-4 py-2 rounded-lg border border-gray-700">
                          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                          <span className="text-sm text-gray-300">Transcribing...</span>
                        </div>
                      )}
                      
                      <button
                        type="button"
                        onClick={toggleRecording}
                        disabled={isProcessing || !selectedDoctor}
                        className={`w-12 h-12 rounded-full flex items-center justify-center text-white shadow-xl transition-all duration-300 ${
                          isRecording
                            ? 'bg-red-600 hover:bg-red-700 animate-pulse ring-4 ring-red-900/30'
                            : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700'
                        } ${(isProcessing || !selectedDoctor) ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title={isRecording ? 'Stop recording (Ctrl+Space)' : 'Start recording (Ctrl+Space)'}
                      >
                        {isRecording ? (
                          <Pause className="text-lg" />
                        ) : (
                          <Mic className="text-lg" />
                        )}
                      </button>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-3">
                    <p className="text-gray-500 text-sm">
                      {selectedDoctor 
                        ? isRecording 
                          ? 'Recording in progress... Press Ctrl+Space to stop'
                          : 'Type or use voice input. Press Ctrl+Space to start recording.'
                        : 'Select a doctor to enable question input'
                      }
                    </p>
                    <button
                      onClick={handleClearQuestions}
                      disabled={!questions.trim()}
                      className="text-sm text-gray-400 hover:text-gray-300 disabled:opacity-50"
                    >
                      <i className="fas fa-trash-alt mr-1"></i>
                      Clear all
                    </button>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end space-x-4 pt-6 border-t border-gray-700">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDoctor(null);
                      setQuestions('');
                    }}
                    className="px-6 py-3 border border-gray-600 text-gray-300 rounded-xl hover:bg-gray-700 font-medium transition-colors flex items-center"
                    disabled={isSaving}
                  >
                    <i className="fas fa-times mr-2"></i>
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={saveQuestions}
                    disabled={!selectedDoctor || !questions.trim() || isSaving}
                    className={`px-6 py-3 rounded-xl font-medium transition-colors flex items-center ${
                      !selectedDoctor || !questions.trim() || isSaving
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg'
                    }`}
                  >
                    {isSaving ? (
                      <>
                        <i className="fas fa-spinner fa-spin mr-2"></i>
                        Saving...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-save mr-2"></i>
                        Save Questions
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Inline Styles for animations */}
      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
        
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
        
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        
        .animate-pulse {
          animation: pulse 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default PreScreeningQuestionsForm;