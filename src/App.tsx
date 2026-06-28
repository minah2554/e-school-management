import React, { useState, useEffect } from 'react';
import { 
  Calendar, Users, FileText, CheckCircle, UploadCloud, AlertTriangle, 
  Plus, Trash2, BookOpen, Sparkles, Clock, Check, 
  ChevronLeft, ChevronRight, File, Info, Copy, Settings, RefreshCw, X,
  ExternalLink, ChevronDown, CheckSquare, Square, Download, Share2
} from 'lucide-react';

// Firebase Modules for future cloud upgrade (Standard Rules Guard applied)
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, collection, onSnapshot, updateDoc, deleteDoc } from 'firebase/firestore';

// Declare global variables for Firebase configuration to satisfy TypeScript compiler
declare global {
  const __firebase_config: string | undefined;
  const __app_id: string | undefined;
  const __initial_auth_token: string | undefined;
}

// --- Firebase Fallback Setup ---
let db: any = null;
let auth: any = null;
let appId = 'student-athlete-manager';
let isFirebaseAvailable = false;

if (typeof __firebase_config !== 'undefined' && __firebase_config) {
  try {
    const firebaseConfig = JSON.parse(__firebase_config);
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    isFirebaseAvailable = true;
  } catch (e) {
    console.error("Firebase initialization failed, switching to local storage.", e);
  }
}

// --- Privacy Protection Helper to Sanitize Filenames ---
const sanitizeFileName = (fileName: string, studentName: string): string => {
  if (!fileName) return '';
  let name = fileName;
  
  // 1. Mask resident registration numbers (RRN / 주민등록번호): e.g., 990101-1234567 -> 990101-*******
  name = name.replace(/\d{6}-[1-8]\d{6}/g, (match) => {
    return match.substring(0, 7) + '*******';
  });
  
  // 2. Mask phone numbers: e.g., 010-1234-5678 -> 010-****-****
  name = name.replace(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, (match) => {
    return match.replace(/[-.\s]?\d{3,4}[-.\s]?\d{4}$/, (m) => {
      return m.replace(/\d/g, '*');
    });
  });

  // 3. Mask student's name if it appears in the filename: e.g., 김진우 -> 김*우, 이지아 -> 이*아
  if (studentName && studentName.length >= 2) {
    const masked = studentName[0] + '*'.repeat(studentName.length - 2) + studentName[studentName.length - 1];
    const escapedStudentName = studentName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escapedStudentName, 'g');
    name = name.replace(regex, masked);
  }
  
  return name;
};

// --- Smart Default Hours Calculations based on Weekday ---
const getDefaultMissingHoursForDate = (dateStr: string): number => {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  if (day === 1 || day === 3 || day === 5) {
    return 6;
  } else if (day === 2 || day === 4) {
    return 7;
  }
  return 0; // Weekend
};

const getDefaultPeriodInfoForDate = (dateStr: string, attendanceType: string, missingHours: number): string => {
  if (attendanceType === '결석') {
    return '종일결석';
  }
  return `${missingHours}교시 ${attendanceType}`;
};

// e-school hours: 1~2 hours -> 1 hour, 3+ hours -> 2 hours (Max 2 hours/day)
const calculateEschoolHours = (hours: number) => {
  const num = Number(hours);
  if (isNaN(num) || num <= 0) return 0;
  if (num <= 2) return 1;
  return 2;
};

// --- Smart OCR Document Parser Simulation ---
const parseOcrFromFilename = (fileName: string, students: any[]): any => {
  let year = 2026; // Default to 2026 as per user mock data
  let month = 5; // Default to May
  
  // Extract month if pattern like "5월" or "05" exists
  const monthMatch = fileName.match(/(\d{1,2})월/);
  if (monthMatch) {
    month = parseInt(monthMatch[1], 10);
  } else {
    const slashMatch = fileName.match(/(\d{1,2})[\/\-]\d{1,2}/);
    if (slashMatch) {
      month = parseInt(slashMatch[1], 10);
    }
  }

  // Extract all days from patterns like "7일", "12일", "14일" or "5/7", "5/12"
  const days: number[] = [];
  
  // Try to match patterns like "7일", "12일"
  const dayMatches = fileName.matchAll(/(\d{1,2})일/g);
  for (const m of dayMatches) {
    days.push(parseInt(m[1], 10));
  }

  // If no "X일" matches, try matching standalone numbers in filename
  if (days.length === 0) {
    const standaloneMatches = fileName.matchAll(/\b(\d{1,2})\b/g);
    for (const m of standaloneMatches) {
      const num = parseInt(m[1], 10);
      if (num > 0 && num <= 31 && num !== month) {
        days.push(num);
      }
    }
  }

  // Sort days
  days.sort((a, b) => a - b);

  // If we found some days, map them to date strings
  const dailyDetails: any[] = [];

  if (days.length > 0) {
    days.forEach(day => {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const defaultHours = getDefaultMissingHoursForDate(dateStr);
      dailyDetails.push({
        date: dateStr,
        attendanceType: defaultHours > 0 ? '조퇴' : '결석',
        missingHours: defaultHours,
        eschoolHours: calculateEschoolHours(defaultHours),
        periodInfo: defaultHours > 0 ? `${defaultHours}교시 조퇴` : '종일결석'
      });
    });
  } else {
    // Default 4 days fallback if no dates found in name
    const defaultDays = [7, 12, 14, 26];
    defaultDays.forEach(day => {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const defaultHours = getDefaultMissingHoursForDate(dateStr);
      dailyDetails.push({
        date: dateStr,
        attendanceType: '조퇴',
        missingHours: defaultHours,
        eschoolHours: calculateEschoolHours(defaultHours),
        periodInfo: `${defaultHours}교시 조퇴`
      });
    });
  }

  // Find start and end dates
  const sortedDetails = [...dailyDetails].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const startDate = sortedDetails[0]?.date || `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = sortedDetails[sortedDetails.length - 1]?.date || `${year}-${String(month).padStart(2, '0')}-31`;

  const student = students[0];
  const sanitizedName = sanitizeFileName(fileName, student ? student.name : '');

  return {
    title: sanitizedName.replace(/\.[^/.]+$/, "") + " 출석 인정",
    studentId: student?.id || '',
    type: 'competition',
    startDate,
    endDate,
    isExceptionEvent: false,
    dailyDetails,
    uploadedDocName: sanitizedName
  };
};

// Mock Initial Students Data (Includes image data: 김진우 2-2 5번)
const INITIAL_STUDENTS = [
  { id: 'stud_image_data', name: '김진우', sport: '축구 (레오 FC)', gradeClass: '2학년 2반', number: '5', usedDays: 0, accumulatedHours: 4, runUpStatus: {} },
  { id: 'stud_1', name: '김태웅', sport: '야구', gradeClass: '2학년 3반', number: '12', usedDays: 4, accumulatedHours: 2, runUpStatus: {} },
  { id: 'stud_2', name: '이지아', sport: '펜싱', gradeClass: '1학년 5반', number: '17', usedDays: 0, accumulatedHours: 5, runUpStatus: {} },
  { id: 'stud_3', name: '박민재', sport: '농구', gradeClass: '3학년 2반', number: '3', usedDays: 12, accumulatedHours: 0, runUpStatus: { '수학': 12, '영어': 4 } }
];

// Mock Initial Events (Includes the 5월 Image target data)
const INITIAL_EVENTS = [
  {
    id: 'evt_image_data',
    studentId: 'stud_image_data',
    title: '레오 FC 평일 연습 경기 및 2026 중등축구리그 평일 경기 참가',
    type: 'competition',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    dailyDetails: [
      { date: '2026-05-07', missingHours: 5, eschoolHours: 2, attendanceType: '조퇴', periodInfo: '3교시 조퇴' },
      { date: '2026-05-12', missingHours: 1, eschoolHours: 1, attendanceType: '조퇴', periodInfo: '7교시 조퇴' },
      { date: '2026-05-14', missingHours: 3, eschoolHours: 2, attendanceType: '조퇴', periodInfo: '5교시 조퇴' },
      { date: '2026-05-26', missingHours: 1, eschoolHours: 1, attendanceType: '조퇴', periodInfo: '7교시 조퇴' }
    ],
    isExceptionEvent: false,
    checklist: {
      neisInput: false,
      eschoolAssigned: true,
      reportSubmitted: true,
      certSubmitted: false
    },
    files: {
      document: 'LEO_FC_평일_연습경기_참가_협조_요청_건.pdf',
      report: '5월_학생선수활동보고서_김진우.hwp',
      cert: ''
    }
  },
  {
    id: 'evt_1',
    studentId: 'stud_1',
    title: '제55회 전국소년체육대회 대표 선발전',
    type: 'competition', 
    startDate: '2026-06-15',
    endDate: '2026-06-16',
    dailyDetails: [
      { date: '2026-06-15', missingHours: 6, eschoolHours: 2, attendanceType: '결석', periodInfo: '종일결석' },
      { date: '2026-06-16', missingHours: 4, eschoolHours: 2, attendanceType: '결석', periodInfo: '종일결석' }
    ],
    isExceptionEvent: true, // 소년체전 예외 (35일 산입 안됨)
    checklist: {
      neisInput: true,
      eschoolAssigned: true,
      reportSubmitted: true,
      certSubmitted: false
    },
    files: {
      document: '공문_소년체전_선발전.pdf',
      report: '김태웅_활동보고서_0615.hwp',
      cert: ''
    }
  }
];

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [students, setStudents] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbMode, setDbMode] = useState(isFirebaseAvailable ? 'Cloud (Firebase)' : 'Local (Browser)');

  // Selected state for dialogs and detail screens
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  
  // Consolidated Month Draft Selection
  const [draftMonth, setDraftMonth] = useState('5');
  const [draftStudentId, setDraftStudentId] = useState('stud_image_data');

  // Calendar State
  const [currentDate, setCurrentDate] = useState(new Date(2026, 4, 15)); // Set default view to May 2026
  const [selectedDateEvents, setSelectedDateEvents] = useState<any[]>([]);

  // Toast notification state
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  // OCR Simulator state
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrPrefilled, setOcrPrefilled] = useState<any>(null);

  // Dynamic daily details inside schedule creator
  const [modalDailyDetails, setModalDailyDetails] = useState<any[]>([]);

  // AI Draft Generator State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState('');

  // Clear AI response when student or month changes
  useEffect(() => {
    setAiResponse('');
  }, [draftStudentId, draftMonth]);

  // --- Firebase Auth & Load ---
  useEffect(() => {
    let unsubscribeUser = () => {};
    
    if (isFirebaseAvailable) {
      const initAuth = async () => {
        try {
          if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
          } else {
            await signInAnonymously(auth);
          }
        } catch (e) {
          console.error("Firebase auth failed, utilizing mock environment auth", e);
          setUser({ uid: 'mock-teacher-user', displayName: '담임교사' });
        }
      };
      initAuth();
      unsubscribeUser = onAuthStateChanged(auth, (authUser) => {
        if (authUser) {
          setUser(authUser);
        } else {
          setUser({ uid: 'mock-teacher-user', displayName: '담임교사' });
        }
      });
    } else {
      // Local Storage Fallback
      setUser({ uid: 'local-teacher-user', displayName: '담임교사' });
      const localStudents = localStorage.getItem('sam_students');
      const localEvents = localStorage.getItem('sam_events');
      if (localStudents) setStudents(JSON.parse(localStudents));
      else {
        setStudents(INITIAL_STUDENTS);
        localStorage.setItem('sam_students', JSON.stringify(INITIAL_STUDENTS));
      }

      if (localEvents) setEvents(JSON.parse(localEvents));
      else {
        setEvents(INITIAL_EVENTS);
        localStorage.setItem('sam_events', JSON.stringify(INITIAL_EVENTS));
      }
      setLoading(false);
    }

    return () => unsubscribeUser();
  }, []);

  // --- Fetching from Firestore if User Active ---
  useEffect(() => {
    if (!isFirebaseAvailable || !user) return;
    setLoading(true);

    const studentsRef = collection(db, 'artifacts', appId, 'public', 'data', 'students');
    const eventsRef = collection(db, 'artifacts', appId, 'public', 'data', 'events');

    // Subscribe to students
    const unsubscribeStudents = onSnapshot(studentsRef, (snapshot) => {
      let studList: any[] = [];
      snapshot.forEach((doc) => {
        studList.push({ id: doc.id, ...doc.data() });
      });
      if (studList.length === 0) {
        // Initialize Firebase with defaults if empty
        INITIAL_STUDENTS.forEach(async (stud) => {
          await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', stud.id), stud);
        });
        setStudents(INITIAL_STUDENTS);
      } else {
        setStudents(studList);
      }
    }, (error) => {
      showToast("데이터를 불러오는데 오류가 발생했습니다. 로컬 모드로 전환합니다.", "error");
      setDbMode("Local Fallback");
    });

    // Subscribe to events
    const unsubscribeEvents = onSnapshot(eventsRef, (snapshot) => {
      let evtList: any[] = [];
      snapshot.forEach((doc) => {
        evtList.push({ id: doc.id, ...doc.data() });
      });
      if (evtList.length === 0) {
        INITIAL_EVENTS.forEach(async (evt) => {
          await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'events', evt.id), evt);
        });
        setEvents(INITIAL_EVENTS);
      } else {
        setEvents(evtList);
      }
      setLoading(false);
    }, (error) => {
      console.error(error);
    });

    return () => {
      unsubscribeStudents();
      unsubscribeEvents();
    };
  }, [user]);

  // Sync to local storage if running in local mode
  const syncLocal = (updatedStudents: any[] | null, updatedEvents: any[] | null) => {
    if (!isFirebaseAvailable) {
      if (updatedStudents) {
        setStudents(updatedStudents);
        localStorage.setItem('sam_students', JSON.stringify(updatedStudents));
      }
      if (updatedEvents) {
        setEvents(updatedEvents);
        localStorage.setItem('sam_events', JSON.stringify(updatedEvents));
      }
    }
  };

  // Toast helper
  const showToast = (message: string, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => {
      setToast({ show: false, message: '', type: 'success' });
    }, 4000);
  };

  // --- CRUD Core Logics ---
  const handleAddStudent = async (name: string, sport: string, gradeClass: string, number: string) => {
    const newStudent = {
      id: 'stud_' + Date.now(),
      name,
      sport,
      gradeClass,
      number,
      usedDays: 0,
      accumulatedHours: 0,
      runUpStatus: {}
    };

    if (isFirebaseAvailable && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', newStudent.id), newStudent);
        showToast(`${name} 학생선수가 성공적으로 등록되었습니다.`);
      } catch (e) {
        showToast("Firebase 저장 실패, 로컬에 저장합니다.", "error");
      }
    } else {
      const list = [...students, newStudent];
      syncLocal(list, null);
      showToast(`${name} 학생선수가 성공적으로 등록되었습니다.`);
    }
    setShowAddStudentModal(false);
  };

  const handleUpdateStudent = async (studentId: string, updatedFields: any) => {
    const updated = students.map(s => s.id === studentId ? { ...s, ...updatedFields } : s);
    if (isFirebaseAvailable && db) {
      try {
        const studentDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'students', studentId);
        await updateDoc(studentDocRef, updatedFields);
      } catch (e) {
        console.error("Firebase update failed", e);
      }
    } else {
      syncLocal(updated, null);
    }
    showToast("학생 정보가 수정되었습니다.");
  };

  const handleAddEvent = async (newEvent: any) => {
    const eventId = 'evt_' + Date.now();
    const eventWithId = { id: eventId, ...newEvent };

    // Calculate days to adjust student usedDays & accumulatedHours
    // Unless it's an exception event (National Sports Festivals, International)
    if (!eventWithId.isExceptionEvent) {
      const student = students.find(s => s.id === eventWithId.studentId);
      if (student) {
        let totalNewAbsences = 0;
        let totalNewHours = 0;

        eventWithId.dailyDetails.forEach((day: any) => {
          if (day.attendanceType === '결석') {
            totalNewAbsences += 1;
          } else {
            // 지각, 조퇴, 결과
            totalNewHours += Number(day.missingHours || 0);
          }
        });

        const newAccumulatedHours = student.accumulatedHours + totalNewHours;
        const convertedDays = Math.floor(newAccumulatedHours / 6);
        const remainingHours = newAccumulatedHours % 6;

        const updatedDays = student.usedDays + totalNewAbsences + convertedDays;
        
        await handleUpdateStudent(student.id, {
          usedDays: Math.min(35, updatedDays),
          accumulatedHours: remainingHours
        });
      }
    }

    if (isFirebaseAvailable && db) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'events', eventId), eventWithId);
        showToast("새 훈련/경기 일정이 캘린더에 성공적으로 자동 배정되었습니다.");
      } catch (e) {
        console.error(e);
      }
    } else {
      const list = [...events, eventWithId];
      syncLocal(null, list);
      showToast("새 훈련/경기 일정이 캘린더에 성공적으로 자동 배정되었습니다.");
    }
    setShowAddEventModal(false);
  };

  const handleDeleteEvent = async (eventId: string) => {
    // Rever used days if needed
    const eventToDelete = events.find(e => e.id === eventId);
    if (eventToDelete && !eventToDelete.isExceptionEvent) {
      const student = students.find(s => s.id === eventToDelete.studentId);
      if (student) {
        let totalAbsences = 0;
        let totalHours = 0;
        eventToDelete.dailyDetails.forEach((day: any) => {
          if (day.attendanceType === '결석') totalAbsences += 1;
          else totalHours += Number(day.missingHours || 0);
        });

        // Soft reduction from student stats
        let rawHours = (student.usedDays * 6 + student.accumulatedHours) - (totalAbsences * 6 + totalHours);
        if (rawHours < 0) rawHours = 0;
        const restoredDays = Math.floor(rawHours / 6);
        const restoredHours = rawHours % 6;

        await handleUpdateStudent(student.id, {
          usedDays: restoredDays,
          accumulatedHours: restoredHours
        });
      }
    }

    if (isFirebaseAvailable && db) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'events', eventId));
        showToast("일정이 정상적으로 삭제되었습니다.", "info");
      } catch (e) {
        console.error(e);
      }
    } else {
      const filtered = events.filter(e => e.id !== eventId);
      syncLocal(null, filtered);
      showToast("일정이 정상적으로 삭제되었습니다.", "info");
    }
    setSelectedEvent(null);
  };

  const handleToggleChecklist = async (eventId: string, checkKey: string) => {
    const targetEvent = events.find(e => e.id === eventId);
    if (!targetEvent) return;

    const currentValue = targetEvent.checklist[checkKey];
    const updatedChecklist = { ...targetEvent.checklist, [checkKey]: !currentValue };
    
    const updatedFiles = { ...targetEvent.files };
    if (checkKey === 'reportSubmitted' && currentValue === true) updatedFiles.report = '';
    if (checkKey === 'certSubmitted' && currentValue === true) updatedFiles.cert = '';

    if (isFirebaseAvailable && db) {
      try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'events', eventId), {
          checklist: updatedChecklist,
          files: updatedFiles
        });
      } catch (e) {
        console.error(e);
      }
    } else {
      const updated = events.map(e => e.id === eventId ? { ...e, checklist: updatedChecklist, files: updatedFiles } : e);
      syncLocal(null, updated);
    }
    showToast(`${checkKey === 'neisInput' ? '나이스 출결' : checkKey === 'eschoolAssigned' ? 'e-school 배정확인' : checkKey === 'reportSubmitted' ? '활동보고서 수합' : '이수확인서 수합'} 상태가 토글되었습니다.`);
  };

  const handleFileUpload = async (eventId: string, fileKey: string, fileName: string) => {
    const targetEvent = events.find(e => e.id === eventId);
    if (!targetEvent) return;

    // Sanitize filename to protect student's privacy
    const student = students.find(s => s.id === targetEvent.studentId);
    const sanitizedName = sanitizeFileName(fileName, student ? student.name : '');

    const updatedFiles = { ...targetEvent.files, [fileKey]: sanitizedName };
    const updatedChecklist = { ...targetEvent.checklist };
    
    if (fileKey === 'report') updatedChecklist.reportSubmitted = true;
    if (fileKey === 'cert') updatedChecklist.certSubmitted = true;
    if (fileKey === 'document') updatedChecklist.neisInput = true;

    if (isFirebaseAvailable && db) {
      try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'events', eventId), {
          files: updatedFiles,
          checklist: updatedChecklist
        });
      } catch (e) {
        console.error(e);
      }
    } else {
      const updated = events.map(e => e.id === eventId ? { ...e, files: updatedFiles, checklist: updatedChecklist } : e);
      syncLocal(null, updated);
    }
    showToast(`${sanitizedName} 파일이 성공적으로 매핑되었습니다.`);
  };

  // --- Smart OCR Document Parser Simulation ---
  const triggerOcrSimulation = (file: File) => {
    if (!file) return;
    setOcrScanning(true);
    setOcrProgress(10);
    
    const interval = setInterval(() => {
      setOcrProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setOcrScanning(false);
            
            // Prefill with smart parsed dates from filename
            const parsedData = parseOcrFromFilename(file.name, students);
            setOcrPrefilled(parsedData);
            setModalDailyDetails(parsedData.dailyDetails);
            setShowAddEventModal(true);
          }, 600);
          return 100;
        }
        return prev + 20;
      });
    }, 200);
  };

  // --- Dynamic modal daily details change handlers ---
  const handleModalDailyDetailChange = (index: number, field: string, value: any) => {
    const updated = [...modalDailyDetails];
    updated[index] = { ...updated[index], [field]: value };
    
    if (field === 'date') {
      // Re-calculate default missing hours and period info if date changed
      const hours = getDefaultMissingHoursForDate(value);
      updated[index].missingHours = hours;
      updated[index].eschoolHours = calculateEschoolHours(hours);
      updated[index].periodInfo = getDefaultPeriodInfoForDate(value, updated[index].attendanceType, hours);
    }
    
    if (field === 'missingHours') {
      const numHours = Number(value);
      updated[index].eschoolHours = calculateEschoolHours(numHours);
      updated[index].periodInfo = getDefaultPeriodInfoForDate(updated[index].date, updated[index].attendanceType, numHours);
    }

    if (field === 'attendanceType') {
      updated[index].periodInfo = getDefaultPeriodInfoForDate(updated[index].date, value, updated[index].missingHours);
    }
    
    setModalDailyDetails(updated);
  };

  // --- AI Draft Generation via serverless /api/gemini-counseling ---
  const handleGenerateAiDraft = async (data: any) => {
    if (!data || data.details.length === 0) {
      showToast("선택된 학생과 월에 해당하는 결손 일정이 없습니다.", "error");
      return;
    }

    const leaves = data.details.filter((d: any) => d.attendanceType === '결석');
    const earlyOuts = data.details.filter((d: any) => d.attendanceType === '조퇴');
    const lates = data.details.filter((d: any) => d.attendanceType === '지각');

    const anonymizedSport = "[종목]";
    const anonymizedName = "[학생 성명]";
    const anonymizedGradeClass = "[학년반]";
    const anonymizedNumber = "[출석부 번호]";
    
    const eventTitle = data.details[0]?.eventTitle || '학생선수 평일 연습 경기 및 리그 평일 경기 참가';

    const prompt = `너는 학교 행정 업무 및 나이스(NEIS) 기안 공문 작성 전문가이다.
다음 학생선수 학사 결손 및 e-school 이수 통계 데이터를 기반으로 공식적이고 격식 있는 출석인정 결재 기안문 본문을 작성해줘.

[데이터 및 조건]
- 대상 학생 정보: ${anonymizedGradeClass} ${anonymizedNumber} ${anonymizedName} (종목: ${anonymizedSport})
- 대상 월: ${draftMonth}월
- 결손 인정기간 및 세부 내역:
  * 인정 조퇴: ${earlyOuts.map((d: any) => `${d.date} (${d.periodInfo || '조퇴'})`).join(', ') || '없음'}
  * 인정 결석: ${leaves.map((d: any) => `${d.date} (인정결석)`).join(', ') || '없음'}
  * 인정 지각: ${lates.map((d: any) => `${d.date} (인정지각)`).join(', ') || '없음'}
- e-school 학습 이수 필수 요건: 총 ${data.totalEschoolHours}시간 이수 확인됨.
- 대표 사유: ${eventTitle}

[공문 작성 지침]
1. 정중하고 공식적인 기안 공문 형식을 준수하라.
2. 개인정보 보호를 위해 기안문 내용에서 학생 이름은 반드시 "[학생 성명]", 학반 번호는 "[학년반]" 또는 "[출석부 번호]"로 치환하여 작성하라.
3. 사유, 인정기간, 증빙서류 수합 여부(활동보고서, 이수확인서 등)가 항목별로 명확하게 번호를 매겨 구분되도록 구조화하라.
4. 나이스 본문에 바로 복사해 쓸 수 있도록 불필요한 서론/결론 코멘트나 설명 없이 기안문 본문 텍스트만 출력하라.`;

    setAiLoading(true);
    setAiResponse('');
    try {
      const res = await fetch('/api/gemini-counseling', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt })
      });

      const result = await res.json();
      if (res.ok) {
        let text = result.text || '';
        
        // Client-side restoration of anonymized fields
        const namePlaceholder = /\[학생\s*성명\]/gi;
        const gradeClassPlaceholder = /\[학년반\]/gi;
        const numberPlaceholder = /\[출석부\s*번호\]/gi;
        const sportPlaceholder = /\[종목\]/gi;

        text = text.replace(namePlaceholder, data.student.name);
        text = text.replace(gradeClassPlaceholder, data.student.gradeClass);
        text = text.replace(numberPlaceholder, data.student.number + '번');
        text = text.replace(sportPlaceholder, data.student.sport);

        setAiResponse(text);
        showToast("AI 기안문 작성이 완료되었습니다.");
      } else {
        showToast(result.error || "AI 기안문 생성 중 오류가 발생했습니다.", "error");
      }
    } catch (err: any) {
      showToast("서버 연결 실패: " + err.message, "error");
    } finally {
      setAiLoading(false);
    }
  };

  // --- Helper Calendars Calculation ---
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const getEventsForDate = (dateStr: string) => {
    return events.filter(evt => {
      // If it's a month-long event (like May 1 to May 31), check if date falls in dailyDetails dates
      if (evt.dailyDetails && evt.dailyDetails.length > 0) {
        return evt.dailyDetails.some((d: any) => d.date === dateStr);
      }
      const start = new Date(evt.startDate);
      const end = new Date(evt.endDate);
      const curr = new Date(dateStr);
      
      start.setHours(0,0,0,0);
      end.setHours(0,0,0,0);
      curr.setHours(0,0,0,0);

      return curr >= start && curr <= end;
    });
  };

  // --- Monthly Dashboard Aggregation Stats ---
  const getMonthlyStats = () => {
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth(); // 0-indexed
    
    // Filter events that overlap with current month
    const monthlyEvents = events.filter(evt => {
      const start = new Date(evt.startDate);
      const end = new Date(evt.endDate);
      
      const currentMonthStart = new Date(currentYear, currentMonth, 1);
      const currentMonthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);
      
      return (start <= currentMonthEnd && end >= currentMonthStart);
    });

    let totalEschoolHours = 0;
    let neisInputDone = 0;
    let neisInputTotal = 0;
    let eschoolAssignedDone = 0;
    let eschoolAssignedTotal = 0;
    let reportSubmittedDone = 0;
    let reportSubmittedTotal = 0;
    let certSubmittedDone = 0;
    let certSubmittedTotal = 0;

    monthlyEvents.forEach(evt => {
      // Calculate e-school hours for daily details that fall in the current month
      if (evt.dailyDetails) {
        evt.dailyDetails.forEach((day: any) => {
          const dayDate = new Date(day.date);
          if (dayDate.getFullYear() === currentYear && dayDate.getMonth() === currentMonth) {
            totalEschoolHours += day.eschoolHours || 0;
          }
        });
      }

      neisInputTotal++;
      if (evt.checklist.neisInput) neisInputDone++;

      eschoolAssignedTotal++;
      if (evt.checklist.eschoolAssigned) eschoolAssignedDone++;

      reportSubmittedTotal++;
      if (evt.checklist.reportSubmitted) reportSubmittedDone++;

      certSubmittedTotal++;
      if (evt.checklist.certSubmitted) certSubmittedDone++;
    });

    return {
      totalEschoolHours,
      neisInput: { done: neisInputDone, total: neisInputTotal },
      eschoolAssigned: { done: eschoolAssignedDone, total: eschoolAssignedTotal },
      reportSubmitted: { done: reportSubmittedDone, total: reportSubmittedTotal },
      certSubmitted: { done: certSubmittedDone, total: certSubmittedTotal }
    };
  };

  // Quick Stats helper
  const totalStudents = students.length;
  const criticalStudents = students.filter(s => s.usedDays >= 30).length;
  const pendingChecklists = events.filter(e => 
    !e.checklist.neisInput || !e.checklist.eschoolAssigned || 
    !e.checklist.reportSubmitted || !e.checklist.certSubmitted
  ).length;

  // Render Toast
  const renderToast = () => {
    if (!toast.show) return null;
    const colors = {
      success: 'bg-indigo-600 text-white',
      info: 'bg-purple-600 text-white',
      error: 'bg-rose-600 text-white',
    };
    return (
      <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl shadow-2xl transition-all duration-300 transform scale-100 ${colors[toast.type as keyof typeof colors]}`}>
        {toast.type === 'success' && <CheckCircle className="w-5 h-5 flex-shrink-0" />}
        {toast.type === 'info' && <Info className="w-5 h-5 flex-shrink-0" />}
        {toast.type === 'error' && <AlertTriangle className="w-5 h-5 flex-shrink-0" />}
        <span className="font-semibold text-sm">{toast.message}</span>
      </div>
    );
  };

  // Monthly aggregated data for Draft Builder
  const getMonthlyAggregatedData = (studentId: string, monthStr: string) => {
    const studentObj = students.find(s => s.id === studentId);
    if (!studentObj) return null;

    // Filter events of that student containing details in target month
    const studentEvents = events.filter(e => e.studentId === studentId);
    let aggregatedDays: any[] = [];
    let officialDocs: string[] = [];

    studentEvents.forEach(evt => {
      if (evt.dailyDetails) {
        evt.dailyDetails.forEach((day: any) => {
          const dParts = day.date.split('-');
          if (dParts[1] === monthStr.padStart(2, '0')) {
            aggregatedDays.push({
              ...day,
              eventTitle: evt.title,
              isExceptionEvent: evt.isExceptionEvent
            });
          }
        });
      }
      if (evt.files.document) {
        officialDocs.push(evt.files.document);
      }
    });

    // Sort by date
    aggregatedDays.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return {
      student: studentObj,
      details: aggregatedDays,
      docs: officialDocs,
      totalEschoolHours: aggregatedDays.reduce((sum, d) => sum + d.eschoolHours, 0)
    };
  };

  // Synchronized first and last day values for modal
  const startVal = modalDailyDetails[0]?.date || '';
  const endVal = modalDailyDetails[modalDailyDetails.length - 1]?.date || '';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {renderToast()}

      {/* Canva-inspired sleek header */}
      <header className="bg-gradient-to-r from-violet-600 via-indigo-600 to-indigo-700 text-white sticky top-0 z-40 px-6 py-4 flex flex-wrap items-center justify-between gap-4 shadow-lg shadow-indigo-100">
        <div className="flex items-center gap-3">
          <div className="bg-white/10 backdrop-blur-md text-white p-2.5 rounded-xl border border-white/20 shadow-inner">
            <Sparkles className="w-6 h-6 text-yellow-300 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
              담임용 학생 선수 관리 <span className="text-[10px] bg-yellow-400 text-indigo-950 px-2.5 py-1 rounded-full font-black uppercase">Homeroom Portal</span>
            </h1>
            <p className="text-xs text-indigo-100 font-medium opacity-90">나이스 출결 점검, e-school 이수 실시간 추적 및 월말 종합 기안 자동 생성기</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Quick link to official e-school */}
          <a 
            href="https://ms.e-school.or.kr/main.do" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-indigo-950 font-extrabold text-xs px-3.5 py-2 rounded-xl transition shadow-md shadow-yellow-500/20"
          >
            <ExternalLink className="w-4 h-4" />
            <span>중학교 e-school 사이트</span>
          </a>

          <div className="flex bg-black/15 p-1 rounded-xl border border-white/10 backdrop-blur-md">
            <button 
              onClick={() => setActiveTab('dashboard')} 
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-black transition-all ${activeTab === 'dashboard' ? 'bg-white text-indigo-900 shadow-sm' : 'text-indigo-100 hover:text-white'}`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>캘린더/일정</span>
            </button>
            <button 
              onClick={() => setActiveTab('students')} 
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-black transition-all ${activeTab === 'students' ? 'bg-white text-indigo-900 shadow-sm' : 'text-indigo-100 hover:text-white'}`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>학급명부 ({totalStudents})</span>
            </button>
            <button 
              onClick={() => setActiveTab('eschool')} 
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-black transition-all ${activeTab === 'eschool' ? 'bg-white text-indigo-900 shadow-sm' : 'text-indigo-100 hover:text-white'}`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>서류 수합/기안 생성</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 flex flex-col gap-6">
        
        {/* Statistics Widgets */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 font-black block mb-1">관리 학생선수</span>
              <span className="text-2xl font-black text-slate-900">{totalStudents}명 등록</span>
            </div>
            <div className="bg-purple-50 text-purple-600 p-3 rounded-2xl">
              <Users className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 font-black block mb-1">행정 미종결 일정</span>
              <span className="text-2xl font-black text-amber-500">{pendingChecklists}건 발생</span>
            </div>
            <div className="bg-amber-50 text-amber-500 p-3 rounded-2xl">
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-400 font-black block mb-1">경고선수 (인정결석 30일↑)</span>
              <span className={`text-2xl font-black ${criticalStudents > 0 ? 'text-rose-600' : 'text-slate-900'}`}>{criticalStudents}명</span>
            </div>
            <div className={`p-3 rounded-2xl ${criticalStudents > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-400'}`}>
              <AlertTriangle className="w-6 h-6 animate-pulse" />
            </div>
          </div>

          <div className="bg-gradient-to-br from-indigo-900 to-purple-950 p-5 rounded-2xl shadow-lg text-white">
            <div className="w-full">
              <span className="text-xs text-indigo-200 font-bold block mb-1">공문 간편 드래그 업로드</span>
              <p className="text-[11px] text-indigo-200 mb-2">공문서 이미지/PDF를 올리면 일정을 자동 분류합니다.</p>
              
              <label className="bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl px-3 py-1.5 cursor-pointer text-xs font-bold transition flex items-center justify-center gap-1.5 w-full">
                <UploadCloud className="w-4 h-4" />
                <span>공문 업로드 (김진우 예시)</span>
                <input 
                  type="file" 
                  accept=".pdf,image/*,.hwp,.docx" 
                  className="hidden" 
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) triggerOcrSimulation(file);
                  }}
                />
              </label>
              <p className="text-[9px] text-indigo-300 mt-2 flex items-center gap-1">
                <span>🔒 개인정보 보호: 실제 파일은 서버에 전송되지 않고 브라우저 내에서만 처리되며 파일명 내 이름/연락처 등은 자동 비식별화 처리됩니다.</span>
              </p>
            </div>
          </div>
        </section>

        {/* OCR Scanner Alert Indicator */}
        {ocrScanning && (
          <div className="bg-indigo-950 text-white p-5 rounded-2xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-4 border border-indigo-500/20 animate-pulse">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-500/20 rounded-xl">
                <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
              </div>
              <div>
                <h4 className="font-extrabold text-sm text-indigo-100">AI 공문서 이미지 분석 엔진 작동 중...</h4>
                <p className="text-xs text-indigo-300">업로드하신 공문에서 학생선수(김진우), 결손일정(5/7, 5/12, 5/14, 5/26 조퇴) 및 교과 정보수치를 디코딩하고 있습니다.</p>
              </div>
            </div>
            <div className="w-full md:w-64 bg-indigo-900/50 rounded-full h-3 overflow-hidden border border-indigo-700">
              <div className="bg-indigo-400 h-full transition-all duration-200" style={{ width: `${ocrProgress}%` }}></div>
            </div>
          </div>
        )}

        {/* TAB 1: CALENDAR & QUICK STATUS */}
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Calendar Core Section */}
            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="font-extrabold text-lg text-slate-900">학사 출결 & e-school 스케줄러</h3>
                  <p className="text-xs text-slate-500">지정 날짜를 클릭하여 학생별 결손수업 조퇴/결석 상세내역을 간편 검수하세요.</p>
                </div>
                <div className="flex items-center gap-2 self-start">
                  <button onClick={prevMonth} className="p-2 hover:bg-slate-100 rounded-lg transition">
                    <ChevronLeft className="w-5 h-5 text-slate-600" />
                  </button>
                  <span className="text-sm font-black text-slate-900 min-w-[120px] text-center">
                    {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월
                  </span>
                  <button onClick={nextMonth} className="p-2 hover:bg-slate-100 rounded-lg transition">
                    <ChevronRight className="w-5 h-5 text-slate-600" />
                  </button>
                </div>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 text-center gap-1 mb-2">
                {['일', '월', '화', '수', '목', '금', '토'].map((d, idx) => (
                  <span key={idx} className={`text-xs font-bold py-1.5 ${idx === 0 ? 'text-rose-500' : idx === 6 ? 'text-indigo-500' : 'text-slate-400'}`}>
                    {d}
                  </span>
                ))}
              </div>

              {/* Month dates builder */}
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: getFirstDayOfMonth(currentDate) }).map((_, idx) => (
                  <div key={`empty-${idx}`} className="bg-slate-50/50 rounded-xl h-20 border border-slate-100/50"></div>
                ))}
                
                {Array.from({ length: getDaysInMonth(currentDate) }).map((_, idx) => {
                  const dayNum = idx + 1;
                  const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                  const dayEvents = getEventsForDate(dateStr);
                  
                  // Mock highlighting
                  const isCurrent = dayNum === 15 && currentDate.getMonth() === 4; 

                  return (
                    <button 
                      key={dayNum} 
                      onClick={() => setSelectedDateEvents(dayEvents)}
                      className={`h-24 p-1.5 rounded-xl border flex flex-col text-left transition relative group ${
                        isCurrent 
                          ? 'border-indigo-600 bg-indigo-50/20 ring-2 ring-indigo-600/10' 
                          : 'border-slate-100 hover:border-slate-300 bg-white'
                      } ${dayEvents.length > 0 ? 'shadow-sm shadow-indigo-50/30' : ''}`}
                    >
                      <span className={`text-xs font-bold leading-none mb-1 inline-block p-1 rounded ${
                        isCurrent ? 'bg-indigo-600 text-white font-extrabold shadow-sm' : 'text-slate-600'
                      }`}>
                        {dayNum}
                      </span>

                      {/* Display small dots or tags for athletes scheduled */}
                      <div className="flex-1 overflow-y-auto space-y-1.5 scrollbar-none mt-1 w-full">
                        {dayEvents.map(evt => {
                          const student = students.find(s => s.id === evt.studentId);
                          
                          // Find period detail for this date if exists
                          const dayDetail = evt.dailyDetails?.find((d: any) => d.date === dateStr);
                          if (!dayDetail) return null;

                          return (
                            <div 
                              key={evt.id} 
                              className="bg-slate-50 border border-slate-200 p-1.5 rounded-lg flex flex-col gap-1 shadow-sm"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-extrabold text-[10px] text-slate-900 truncate">
                                  {student ? student.name.substring(0, 1) + '*' + student.name.substring(student.name.length - 1) : '학생'}
                                </span>
                                <span className={`text-[8px] px-1 py-0.5 rounded-sm font-black flex-shrink-0 ${
                                  dayDetail.attendanceType === '결석' ? 'bg-rose-100 text-rose-800' :
                                  dayDetail.attendanceType === '조퇴' ? 'bg-amber-100 text-amber-800' :
                                  'bg-blue-100 text-blue-800'
                                }`}>
                                  {dayDetail.attendanceType} {dayDetail.missingHours}h
                                </span>
                              </div>
                              {dayDetail.eschoolHours > 0 && (
                                <span className="text-[8px] bg-emerald-100 text-emerald-800 px-1 py-0.5 rounded-sm font-black text-center block">
                                  e스쿨 {dayDetail.eschoolHours}h
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Legends */}
              <div className="mt-5 flex flex-wrap items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/60 text-xs text-slate-500 font-semibold">
                <span className="font-extrabold text-slate-700">색상 범례:</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-rose-100 border border-rose-300 rounded-sm"></span> 대회 조퇴/결석</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-purple-100 border border-purple-300 rounded-sm"></span> 상시/평일 훈련</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-slate-200 border border-slate-300 rounded-sm"></span> 일반 일과</span>
              </div>
            </div>

            {/* Selection Panel / Actions */}
            <div className="space-y-6">
              
              {/* 월간 행정 현황판 */}
              {(() => {
                const stats = getMonthlyStats();
                return (
                  <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white p-5 rounded-2xl shadow-lg border border-indigo-500/10 space-y-4">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <h4 className="font-extrabold text-xs tracking-tight flex items-center gap-1.5 text-yellow-300">
                        <Sparkles className="w-4 h-4 text-yellow-300 animate-pulse" />
                        <span>{currentDate.getMonth() + 1}월 행정 현황판</span>
                      </h4>
                      <span className="text-[10px] font-bold text-slate-400">실시간 연동</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="bg-white/5 p-2.5 rounded-xl border border-white/5">
                        <span className="text-[10px] text-slate-400 block font-semibold">e-school 배정 시간</span>
                        <span className="text-lg font-black text-indigo-300">{stats.totalEschoolHours}시간</span>
                      </div>
                      <div className="bg-white/5 p-2.5 rounded-xl border border-white/5 flex flex-col justify-center">
                        <span className="text-[10px] text-slate-400 block font-semibold">나이스 전체 입력</span>
                        <span className="text-lg font-black text-slate-200">{stats.neisInput.done} / {stats.neisInput.total}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-bold pt-1">
                      <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                        <span className="text-[9px] text-slate-400 block font-medium">이-스쿨 확인</span>
                        <span className="text-xs font-black text-slate-200">{stats.eschoolAssigned.done}/{stats.eschoolAssigned.total}</span>
                      </div>
                      <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                        <span className="text-[9px] text-slate-400 block font-medium">활동보고 수합</span>
                        <span className="text-xs font-black text-slate-200">{stats.reportSubmitted.done}/{stats.reportSubmitted.total}</span>
                      </div>
                      <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                        <span className="text-[9px] text-slate-400 block font-medium">이수증 수합</span>
                        <span className="text-xs font-black text-slate-200">{stats.certSubmitted.done}/{stats.certSubmitted.total}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Daily details trigger */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                  <h4 className="font-extrabold text-sm text-slate-900 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-indigo-600" />
                    선택 날짜 일정 리스트
                  </h4>
                  <button 
                    onClick={() => {
                      setOcrPrefilled(null);
                      // Set default single day
                      const defaultDate = '2026-05-15';
                      const defaultHours = getDefaultMissingHoursForDate(defaultDate);
                      setModalDailyDetails([{
                        date: defaultDate,
                        attendanceType: '조퇴',
                        missingHours: defaultHours,
                        eschoolHours: calculateEschoolHours(defaultHours),
                        periodInfo: `${defaultHours}교시 조퇴`
                      }]);
                      setShowAddEventModal(true);
                    }}
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>추가</span>
                  </button>
                </div>

                {selectedDateEvents.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-xs font-bold leading-relaxed">달력에서 결손 일정이 표시된 날을<br />클릭하여 업무를 간편 체크하세요.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {selectedDateEvents.map(evt => {
                      const student = students.find(s => s.id === evt.studentId);
                      return (
                        <div key={evt.id} className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 relative group">
                          <button 
                            onClick={() => handleDeleteEvent(evt.id)}
                            className="absolute top-3 right-3 text-slate-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition"
                            title="일정 삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-200 text-slate-800">
                              {student?.gradeClass} {student?.number}번
                            </span>
                            <span className="text-sm font-black text-slate-950">{student?.name} ({student?.sport})</span>
                          </div>

                          <h5 className="font-extrabold text-xs text-slate-800 mb-2 leading-relaxed">{evt.title}</h5>

                          {/* Quick checklist buttons on the card directly */}
                          <div className="bg-white p-3 rounded-xl border border-slate-200/60 space-y-2 mb-3 shadow-inner">
                            <span className="text-[10px] text-slate-400 font-black block">실시간 담임 체크란:</span>
                            <div className="grid grid-cols-2 gap-2">
                              
                              <button 
                                onClick={() => handleToggleChecklist(evt.id, 'neisInput')}
                                className={`flex items-center gap-1.5 text-left text-xs p-1.5 rounded-lg border transition ${
                                  evt.checklist.neisInput 
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-extrabold' 
                                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                {evt.checklist.neisInput ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5" />}
                                <span className="truncate">1. 나이스 입력</span>
                              </button>

                              <button 
                                onClick={() => handleToggleChecklist(evt.id, 'eschoolAssigned')}
                                className={`flex items-center gap-1.5 text-left text-xs p-1.5 rounded-lg border transition ${
                                  evt.checklist.eschoolAssigned 
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-extrabold' 
                                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                {evt.checklist.eschoolAssigned ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5" />}
                                <span className="truncate">2. 이스쿨 확인</span>
                              </button>

                              <button 
                                onClick={() => handleToggleChecklist(evt.id, 'reportSubmitted')}
                                className={`flex items-center gap-1.5 text-left text-xs p-1.5 rounded-lg border transition ${
                                  evt.checklist.reportSubmitted 
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-extrabold' 
                                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                {evt.checklist.reportSubmitted ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5" />}
                                <span className="truncate">3. 활동보고서</span>
                              </button>

                              <button 
                                onClick={() => handleToggleChecklist(evt.id, 'certSubmitted')}
                                className={`flex items-center gap-1.5 text-left text-xs p-1.5 rounded-lg border transition ${
                                  evt.checklist.certSubmitted 
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 font-extrabold' 
                                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                                }`}
                              >
                                {evt.checklist.certSubmitted ? <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> : <Clock className="w-3.5 h-3.5" />}
                                <span className="truncate">4. 이수증 수합</span>
                              </button>

                            </div>
                          </div>

                          <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-400 font-bold">인정출결 차감 대상</span>
                            <button 
                              onClick={() => {
                                setSelectedEvent(evt);
                                setActiveTab('eschool');
                              }}
                              className="font-black text-indigo-600 hover:underline flex items-center gap-0.5"
                            >
                              <span>기안문 생성하기</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Canva Info Board */}
              <div className="bg-gradient-to-br from-purple-900 to-indigo-950 text-white p-5 rounded-2xl shadow-lg shadow-indigo-100 space-y-4">
                <h4 className="font-extrabold text-sm flex items-center gap-2 text-yellow-300">
                  <BookOpen className="w-4 h-4" />
                  교사용 출결 & e-school 규정
                </h4>
                
                <div className="space-y-3 text-xs text-indigo-100/95 leading-relaxed">
                  <div className="bg-white/10 p-3 rounded-xl border border-white/10">
                    <p className="font-black text-yellow-300 mb-1">⏱ e-school 이수 시간 산출법</p>
                    <ul className="list-disc pl-4 space-y-0.5 font-medium">
                      <li>수업 결손 <strong>1~2시간</strong> 조퇴/지각 $\rightarrow$ <strong>1시간</strong> 배정</li>
                      <li>수업 결손 <strong>3시간 이상</strong> 결석/조퇴 $\rightarrow$ <strong>2시간</strong> 배정 (일 최대 2시간)</li>
                    </ul>
                  </div>

                  <div className="bg-white/10 p-3 rounded-xl border border-white/10">
                    <p className="font-black text-yellow-300 mb-1">⚖️ 조퇴/지각 누적 규정</p>
                    <p className="font-medium">지각, 조퇴, 결과 시수가 <strong>6시간 누적</strong>될 시 나이스상 인정 결석 1일로 변환합니다.</p>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 2: STUDENT MANAGEMENT */}
        {activeTab === 'students' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="font-extrabold text-lg text-slate-900">학급 학생 선수 원격 명부</h3>
                  <p className="text-xs text-slate-500">인정결석 35일 한도 체크 및 학기말 최저학력 미도달 런업 특별 시수를 원격 설계합니다.</p>
                </div>
                <button 
                  onClick={() => setShowAddStudentModal(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center justify-center gap-2 self-start shadow-md shadow-indigo-500/10"
                >
                  <Plus className="w-4 h-4" />
                  <span>새 학생선수 추가</span>
                </button>
              </div>

              {/* Table rendering */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs font-black text-slate-400 bg-slate-50/50">
                      <th className="py-3.5 px-4">학생명 / 반번호</th>
                      <th className="py-3.5 px-4">종목 소속</th>
                      <th className="py-3.5 px-4">출석인정 일수 (35일 한도)</th>
                      <th className="py-3.5 px-4">누적 결손 지결조퇴 시수</th>
                      <th className="py-3.5 px-4">학기말 최저학력 런업 관리</th>
                      <th className="py-3.5 px-4 text-right">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {students.map(student => {
                      const limitPercent = Math.min(100, (student.usedDays / 35) * 100);
                      const isDanger = student.usedDays >= 30;

                      return (
                        <tr key={student.id} className="hover:bg-slate-50/50 transition">
                          <td className="py-4 px-4 font-black">
                            <span className="text-slate-900 block text-md">{student.name}</span>
                            <span className="text-xs text-slate-400 font-semibold">{student.gradeClass} {student.number}번</span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg text-xs font-black">
                              {student.sport}
                            </span>
                          </td>
                          <td className="py-4 px-4 w-64">
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs font-bold">
                                <span className={isDanger ? 'text-rose-600 font-black' : 'text-indigo-600'}>{student.usedDays}일 차감</span>
                                <span className="text-slate-400">잔여: {35 - student.usedDays}일</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200/50">
                                <div 
                                  className={`h-full rounded-full transition-all duration-300 ${isDanger ? 'bg-rose-500' : 'bg-gradient-to-r from-violet-500 to-indigo-600'}`} 
                                  style={{ width: `${limitPercent}%` }}
                                ></div>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4 font-bold text-slate-700">
                            <div className="flex items-center gap-1">
                              <Clock className="w-4 h-4 text-slate-400" />
                              <span>{student.accumulatedHours} / 6 시간</span>
                              <span className="text-[10px] text-slate-400 font-semibold">(6시 누적시 1일 자동변환)</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="space-y-2">
                              <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer text-slate-600">
                                <input 
                                  type="checkbox" 
                                  checked={Object.keys(student.runUpStatus || {}).length > 0}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      handleUpdateStudent(student.id, { runUpStatus: { '국어': 0 } });
                                    } else {
                                      handleUpdateStudent(student.id, { runUpStatus: {} });
                                    }
                                  }}
                                  className="rounded text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 border-slate-300"
                                />
                                <span>최저학력 미달자 지정 (런업프로그램)</span>
                              </label>

                              {Object.keys(student.runUpStatus || {}).length > 0 && (
                                <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-xs space-y-2">
                                  <div className="font-extrabold text-amber-900 flex items-center gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    <span>[런업 프로그램 방학중 과목별 12시간 배정]</span>
                                  </div>
                                  {Object.entries(student.runUpStatus).map(([subject, completedHours]: any) => (
                                    <div key={subject} className="flex items-center justify-between gap-2 text-slate-700">
                                      <span className="font-bold">{subject}</span>
                                      <div className="flex items-center gap-1.5">
                                        <input 
                                          type="number" 
                                          max="12" 
                                          min="0"
                                          value={completedHours}
                                          onChange={(e) => {
                                            const updated = { ...student.runUpStatus, [subject]: Number(e.target.value) };
                                            handleUpdateStudent(student.id, { runUpStatus: updated });
                                          }}
                                          className="w-12 text-center p-1 border border-slate-300 rounded-lg text-xs font-bold"
                                        />
                                        <span className="text-slate-400 font-semibold">/ 12시간</span>
                                        {completedHours >= 12 && <Check className="w-4 h-4 text-emerald-600 font-black" />}
                                      </div>
                                    </div>
                                  ))}
                                  <button 
                                    onClick={() => {
                                      const sName = prompt("미도달 보충 과목명을 입력하세요 (예: 영어, 수학, 과학):");
                                      if (sName) {
                                        const updated = { ...student.runUpStatus, [sName]: 0 };
                                        handleUpdateStudent(student.id, { runUpStatus: updated });
                                      }
                                    }}
                                    className="text-[10px] text-indigo-600 font-black hover:underline"
                                  >
                                    + 미도달 과목 추가
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-right">
                            <button 
                              onClick={async () => {
                                if (confirm(`${student.name} 학생선수를 학급 목록에서 지우시겠습니까?`)) {
                                  if (isFirebaseAvailable && db) {
                                    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'students', student.id));
                                  } else {
                                    const filtered = students.filter(s => s.id !== student.id);
                                    syncLocal(filtered, null);
                                  }
                                  showToast("학생 정보가 정상 삭제되었습니다.", "info");
                                }
                              }}
                              className="text-xs font-bold text-rose-600 hover:text-white border border-rose-200 hover:bg-rose-600 px-2.5 py-1.5 rounded-lg transition"
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: DOCUMENT MANAGEMENT & MONTHLY DRAFT BUILDER */}
        {activeTab === 'eschool' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Event List Tracker & Quick Check */}
            <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
              <div>
                <h3 className="font-extrabold text-lg text-slate-900">결손 보충이수 서류 종합 수합함</h3>
                <p className="text-xs text-slate-500">학생선수들의 대회 및 조퇴 일정에 따른 실시간 체크현황입니다. 각 항목을 클릭하여 빠르고 편리하게 승인 상태를 제어하세요.</p>
              </div>

              {events.length === 0 ? (
                <div className="text-center py-20 bg-slate-50 rounded-2xl border border-slate-100">
                  <FileText className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500 font-bold">등록된 학사 결손 및 대회 참가가 존재하지 않습니다.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {events.map(evt => {
                    const student = students.find(s => s.id === evt.studentId);
                    let checkedCount = 0;
                    if (evt.checklist.neisInput) checkedCount++;
                    if (evt.checklist.eschoolAssigned) checkedCount++;
                    if (evt.checklist.reportSubmitted) checkedCount++;
                    if (evt.checklist.certSubmitted) checkedCount++;
                    const isAllCollected = checkedCount === 4;
                    const isSelected = selectedEvent?.id === evt.id;

                    return (
                      <div 
                        key={evt.id} 
                        className={`p-5 rounded-2xl border transition-all ${
                          isSelected 
                            ? 'border-indigo-600 bg-indigo-50/20 ring-1 ring-indigo-600 shadow-md shadow-indigo-100' 
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded ${
                                evt.type === 'competition' 
                                  ? 'bg-rose-100 text-rose-800' 
                                  : 'bg-indigo-100 text-indigo-800'
                              }`}>
                                {evt.type === 'competition' ? '공문 대회참가' : '훈련 참가'}
                              </span>
                              <span className="text-xs text-slate-500 font-black">{student?.gradeClass} {student?.number}번 {student?.name}</span>
                            </div>
                            <h4 className="font-extrabold text-slate-900 text-sm leading-relaxed">{evt.title}</h4>
                            <p className="text-xs text-slate-400 font-bold">
                              인정기간: {evt.startDate} ~ {evt.endDate} (결손일 {evt.dailyDetails?.length || 1}일)
                            </p>
                          </div>

                          <div className="flex flex-col sm:items-end gap-2">
                            <span className={`text-xs font-black px-3 py-1.5 rounded-full flex items-center gap-1 ${
                              isAllCollected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                            }`}>
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{checkedCount}/4 완료 ({isAllCollected ? '종결 대기' : '수합 중'})</span>
                            </span>
                            <button 
                              onClick={() => {
                                setSelectedEvent(evt);
                                if (student) {
                                  setDraftStudentId(student.id);
                                  // Extract month from startDate
                                  const m = new Date(evt.startDate).getMonth() + 1;
                                  setDraftMonth(String(m));
                                }
                              }}
                              className={`text-xs font-black px-3.5 py-2 rounded-xl transition border ${
                                isSelected 
                                  ? 'bg-indigo-600 text-white border-indigo-600' 
                                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                              }`}
                            >
                              선택 세부 관리
                            </button>
                          </div>
                        </div>

                        {/* Interactive Click Grid to Toggle Verification */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs pt-3 border-t border-slate-100 font-bold">
                          
                          <button 
                            onClick={() => handleToggleChecklist(evt.id, 'neisInput')}
                            className={`p-2.5 rounded-xl flex items-center justify-between border transition ${
                              evt.checklist.neisInput 
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                : 'bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100'
                            }`}
                          >
                            <span>1. 나이스 출결</span>
                            <span>{evt.checklist.neisInput ? '✔️ 등록완료' : '⏳ 미입력'}</span>
                          </button>

                          <button 
                            onClick={() => handleToggleChecklist(evt.id, 'eschoolAssigned')}
                            className={`p-2.5 rounded-xl flex items-center justify-between border transition ${
                              evt.checklist.eschoolAssigned 
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                : 'bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100'
                            }`}
                          >
                            <span>2. 이스쿨 배정</span>
                            <span>{evt.checklist.eschoolAssigned ? '✔️ 배정확인' : '⏳ 미배정'}</span>
                          </button>

                          <button 
                            onClick={() => handleToggleChecklist(evt.id, 'reportSubmitted')}
                            className={`p-2.5 rounded-xl flex items-center justify-between border transition ${
                              evt.checklist.reportSubmitted 
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                : 'bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100'
                            }`}
                          >
                            <span>3. 활동보고서</span>
                            <span>{evt.checklist.reportSubmitted ? '✔️ 수합완료' : '⏳ 미제출'}</span>
                          </button>

                          <button 
                            onClick={() => handleToggleChecklist(evt.id, 'certSubmitted')}
                            className={`p-2.5 rounded-xl flex items-center justify-between border transition ${
                              evt.checklist.certSubmitted 
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                : 'bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100'
                            }`}
                          >
                            <span>4. 이수확인서</span>
                            <span>{evt.checklist.certSubmitted ? '✔️ 수합완료' : '⏳ 미제출'}</span>
                          </button>

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Monthly Draft Generator Panel (Canva Style Canvas) */}
            <div className="space-y-6">
              
              {/* Comprehensive Monthly draft builder */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                  <div className="bg-purple-100 text-purple-700 p-2 rounded-xl">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-900">월말 종합 기안문 생성기</h4>
                    <p className="text-[10px] text-slate-400">학반 학생선수의 결손을 종합 집계합니다.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">대상 학생</label>
                      <select 
                        value={draftStudentId}
                        onChange={(e) => setDraftStudentId(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold bg-slate-50"
                      >
                        {students.map(s => (
                          <option key={s.id} value={s.id}>{s.name} ({s.sport})</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">정리할 대상 월</label>
                      <select 
                        value={draftMonth}
                        onChange={(e) => setDraftMonth(e.target.value)}
                        className="w-full border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold bg-slate-50"
                      >
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map(m => (
                          <option key={m} value={m}>{m}월 출석인정</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Aggregated Preview Area */}
                  {(() => {
                    const data = getMonthlyAggregatedData(draftStudentId, draftMonth);
                    if (!data || data.details.length === 0) {
                      return (
                        <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-xs font-bold leading-relaxed">
                          선택한 월({draftMonth}월)에 등록된<br />학사 결손/조퇴 일정이 없습니다.
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-4">
                        <div className="p-3 bg-indigo-50/40 rounded-xl border border-indigo-100 text-xs space-y-1.5 text-slate-700">
                          <div className="font-extrabold text-indigo-900 flex items-center justify-between mb-1">
                            <span>{draftMonth}월 결손 집계 요약</span>
                            <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                              총 {data.details.length}회 발생
                            </span>
                          </div>
                          <p>• 학생명: <strong>{data.student.name}</strong> ({data.student.gradeClass} {data.student.number}번)</p>
                          <p>• e-school 필요 이수시간: <strong className="text-indigo-600 underline">총 {data.totalEschoolHours}시간</strong></p>
                          <div className="text-[10px] text-slate-400 leading-normal max-h-24 overflow-y-auto pt-1 border-t border-indigo-100/50 space-y-0.5">
                            {data.details.map((d: any, dIdx) => (
                              <p key={dIdx}>• {d.date} ({d.attendanceType} - {d.periodInfo || `${d.missingHours}시간`}) $\rightarrow$ e-school {d.eschoolHours}시간</p>
                            ))}
                          </div>
                        </div>

                        {/* File upload helpers in details panel */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-400 font-black uppercase">서류 수합 업로드 창구:</span>
                            <span className="text-[9px] text-emerald-600 font-bold flex items-center gap-0.5">🔒 개인정보 마스킹 적용</span>
                          </div>
                          
                          <div className="flex items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                            <span className="truncate font-bold text-slate-700">
                              {data.details[0]?.isExceptionEvent ? '💡 전국대회로 공문 필수' : '1. 대회 참가 공문'}
                            </span>
                            <label className="text-[10px] bg-white border border-slate-300 hover:bg-slate-100 px-2 py-1 rounded-lg cursor-pointer font-bold">
                              올리기
                              <input 
                                type="file" 
                                className="hidden" 
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f && selectedEvent) handleFileUpload(selectedEvent.id, 'document', f.name);
                                }}
                              />
                            </label>
                          </div>

                          <div className="flex items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                            <span className="truncate font-bold text-slate-700">2. 개인활동보고서</span>
                            <label className="text-[10px] bg-white border border-slate-300 hover:bg-slate-100 px-2 py-1 rounded-lg cursor-pointer font-bold">
                              올리기
                              <input 
                                type="file" 
                                className="hidden" 
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f && selectedEvent) handleFileUpload(selectedEvent.id, 'report', f.name);
                                }}
                              />
                            </label>
                          </div>

                          <div className="flex items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                            <span className="truncate font-bold text-slate-700">3. e-school 학습이수 확인서</span>
                            <label className="text-[10px] bg-white border border-slate-300 hover:bg-slate-100 px-2 py-1 rounded-lg cursor-pointer font-bold">
                              올리기
                              <input 
                                type="file" 
                                className="hidden" 
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f && selectedEvent) handleFileUpload(selectedEvent.id, 'cert', f.name);
                                }}
                              />
                            </label>
                          </div>
                        </div>

                        {/* Interactive Checkbox Link to e-school site */}
                        <div className="pt-2">
                          <button 
                            onClick={() => setShowDraftModal(true)}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-3 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-100"
                          >
                            <FileText className="w-4 h-4" />
                            <span>{draftMonth}월 종합 기안문 본문 빌드</span>
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* AI Draft Generator Panel */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-lg space-y-4">
                <div className="flex items-center gap-2">
                  <div className="bg-purple-100 text-purple-700 p-2 rounded-xl">
                    <Sparkles className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-sm text-slate-900">✨ AI 기안문 작성 도우미 (Gemini)</h4>
                    <p className="text-[10px] text-slate-400">Gemini 3.1 Flash Lite 기반 공문 자동 기안</p>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-200/60 space-y-1.5 font-medium">
                  <p className="font-bold text-slate-700 flex items-center gap-1">
                    <span>🔒 개인정보 보호 비식별화 적용</span>
                  </p>
                  <p>이름, 학년반 등 민감한 개인정보는 임시 식별자(`[학생 성명]`, `[학년반]`)로 변환되어 안전하게 처리되며, 생성 완료 후 브라우저(로컬)에서 자동으로 다시 복구됩니다.</p>
                </div>

                {(() => {
                  const data = getMonthlyAggregatedData(draftStudentId, draftMonth);
                  if (!data || data.details.length === 0) {
                    return (
                      <div className="text-center py-6 text-slate-400 text-xs font-bold bg-slate-50 rounded-xl border border-dashed border-slate-200 leading-relaxed">
                        선택한 월({draftMonth}월)에 등록된 일정이 없어<br />AI 기안문을 생성할 수 없습니다.
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => handleGenerateAiDraft(data)}
                        disabled={aiLoading}
                        className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold text-xs py-3 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-100 disabled:opacity-50"
                      >
                        {aiLoading ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>AI 기안문 생성 중...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 text-yellow-300" />
                            <span>AI 기안문 자동 생성</span>
                          </>
                        )}
                      </button>

                      {aiResponse && (
                        <div className="space-y-2 pt-2 border-t border-slate-100 animate-in fade-in duration-200">
                          <span className="text-[10px] text-slate-400 font-black block">AI 생성 기안문 본문:</span>
                          <textarea
                            readOnly
                            rows={12}
                            className="w-full border border-slate-300 rounded-xl p-3.5 text-xs font-mono leading-relaxed bg-slate-50 focus:ring-0 focus:border-slate-300 text-slate-800"
                            value={aiResponse}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const tempEl = document.createElement('textarea');
                              tempEl.value = aiResponse;
                              document.body.appendChild(tempEl);
                              tempEl.select();
                              document.execCommand('copy');
                              document.body.removeChild(tempEl);
                              showToast("AI 기안문이 클립보드에 복사되었습니다!");
                            }}
                            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 font-bold text-xs py-2 rounded-xl transition flex items-center justify-center gap-1.5"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>AI 기안문 복사</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

            </div>
          </div>
        )}

      </main>

      {/* MODAL: ADD STUDENT */}
      {showAddStudentModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden border border-slate-200/50">
            <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-6 py-4 flex items-center justify-between">
              <h4 className="font-extrabold text-sm">학급 학생선수 신규 배정</h4>
              <button onClick={() => setShowAddStudentModal(false)} className="text-white/80 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={(e: any) => {
              e.preventDefault();
              const name = e.target.elements.name.value;
              const sport = e.target.elements.sport.value;
              const gradeClass = e.target.elements.gradeClass.value;
              const number = e.target.elements.number.value;
              if (name && sport && gradeClass && number) {
                handleAddStudent(name, sport, gradeClass, number);
              }
            }} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">학생 실명</label>
                <input 
                  type="text" 
                  name="name" 
                  placeholder="예: 김진우"
                  required 
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">종목 및 소속</label>
                  <input 
                    type="text" 
                    name="sport" 
                    placeholder="예: 축구 (레오 FC)"
                    required 
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">출석부 번호</label>
                  <input 
                    type="number" 
                    name="number" 
                    placeholder="예: 5"
                    required 
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">학반 학년</label>
                <input 
                  type="text" 
                  name="gradeClass" 
                  placeholder="예: 2학년 2반"
                  required 
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setShowAddStudentModal(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2.5 rounded-xl transition"
                >
                  취소
                </button>
                <button 
                  type="submit" 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition"
                >
                  등록 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD EVENT */}
      {showAddEventModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden border border-slate-200/50 my-8">
            <div className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-6 py-4 flex items-center justify-between">
              <h4 className="font-extrabold text-sm flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-yellow-300" />
                <span>경기 및 인정 조퇴/결석 세부 설계</span>
              </h4>
              <button 
                onClick={() => {
                  setShowAddEventModal(false);
                  setOcrPrefilled(null);
                }} 
                className="text-white hover:text-white/80 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={(e: any) => {
              e.preventDefault();
              const title = e.target.elements.title.value;
              const studentId = e.target.elements.studentId.value;
              const type = e.target.elements.type.value;
              const isExceptionEvent = e.target.elements.isExceptionEvent.checked;

              if (modalDailyDetails.length === 0) {
                alert("일자별 인정 시간 정보를 최소 1개 이상 등록해 주세요.");
                return;
              }

              handleAddEvent({
                studentId,
                title,
                type,
                startDate: startVal,
                endDate: endVal,
                dailyDetails: modalDailyDetails,
                isExceptionEvent,
                checklist: {
                  neisInput: false,
                  eschoolAssigned: true,
                  reportSubmitted: false,
                  certSubmitted: false
                },
                files: {
                  document: ocrPrefilled?.uploadedDocName || '',
                  report: '',
                  cert: ''
                }
              });

            }} className="p-6 space-y-4">
              
              {ocrPrefilled && (
                <div className="bg-emerald-50 text-emerald-800 p-3.5 rounded-xl border border-emerald-200 text-xs font-semibold">
                  🎉 업로드한 공문 분석 완료! 요일별 출석인정 세부 내역이 자동 매핑되었습니다.
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">대상 학생선수</label>
                  <select 
                    name="studentId" 
                    required 
                    defaultValue={ocrPrefilled?.studentId || "stud_image_data"}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white focus:ring-2 focus:ring-indigo-500"
                  >
                    {students.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.sport})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">사유 및 일정구분</label>
                  <select 
                    name="type" 
                    required 
                    defaultValue={ocrPrefilled?.type || "competition"}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="competition">평일 연습 경기 및 중등리그 참가</option>
                    <option value="training">상시 훈련 참가</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">공문 대회/훈련 사유 명칭</label>
                <input 
                  type="text" 
                  name="title" 
                  placeholder="예: 레오 FC 평일 연습 경기 및 2026 중등축구리그"
                  defaultValue={ocrPrefilled?.title || "레오 FC 평일 연습 경기 및 2026 중등축구리그 평일 경기 참가"}
                  required 
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">인정 기간 시작일</label>
                  <input 
                    type="date" 
                    name="startDate" 
                    value={startVal}
                    onChange={(e) => {
                      if (modalDailyDetails.length > 0) {
                        handleModalDailyDetailChange(0, 'date', e.target.value);
                      }
                    }}
                    required 
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">인정 기간 종료일</label>
                  <input 
                    type="date" 
                    name="endDate" 
                    value={endVal}
                    onChange={(e) => {
                      if (modalDailyDetails.length > 0) {
                        handleModalDailyDetailChange(modalDailyDetails.length - 1, 'date', e.target.value);
                      }
                    }}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 bg-slate-50"
                  />
                </div>
              </div>

              {/* Exception */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    name="isExceptionEvent" 
                    defaultChecked={ocrPrefilled?.isExceptionEvent || false}
                    className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4 border-slate-300"
                  />
                  <div>
                    <span className="font-extrabold text-slate-800 block">출석인정결석 허용일수(35일) 산입 제외 대상</span>
                    <span className="text-slate-400">소년체전, 전국체전, 국가대표 자격 소집 훈련 등</span>
                  </div>
                </label>
              </div>

              {/* Day details - Dynamic schedule editor */}
              <div className="space-y-3 pt-3 border-t border-slate-100 max-h-[300px] overflow-y-auto pr-1">
                <span className="text-xs font-black text-slate-700 block">⏱ 일자별 인정 시간 정보 등록</span>
                
                {modalDailyDetails.map((day, index) => (
                  <div key={index} className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2 relative">
                    <button 
                      type="button"
                      onClick={() => {
                        const updated = modalDailyDetails.filter((_, i) => i !== index);
                        setModalDailyDetails(updated);
                      }}
                      className="absolute top-2 right-2 text-slate-400 hover:text-rose-600 transition"
                      title="일정에서 제거"
                    >
                      <X className="w-4 h-4" />
                    </button>

                    <div className="grid grid-cols-3 gap-2 items-end">
                      <div>
                        <label className="text-[10px] text-slate-400 font-black block mb-0.5">날짜</label>
                        <input 
                          type="date" 
                          value={day.date}
                          onChange={(e) => handleModalDailyDetailChange(index, 'date', e.target.value)}
                          className="w-full border border-slate-300 rounded-lg p-1 text-[11px] font-bold bg-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-black block mb-0.5">일정 구분</label>
                        <select 
                          value={day.attendanceType} 
                          onChange={(e) => handleModalDailyDetailChange(index, 'attendanceType', e.target.value)}
                          className="w-full border border-slate-300 rounded-lg p-1 text-[11px] bg-white font-bold"
                        >
                          <option value="조퇴">인정 조퇴</option>
                          <option value="결석">인정 결석</option>
                          <option value="지각">인정 지각</option>
                        </select>
                      </div>
                      <div className="flex gap-1.5 items-end justify-between">
                        <div className="flex-1">
                          <label className="text-[10px] text-slate-400 font-black block mb-0.5">결손시수</label>
                          <input 
                            type="number" 
                            min="1" 
                            max="7" 
                            value={day.missingHours}
                            onChange={(e) => handleModalDailyDetailChange(index, 'missingHours', Number(e.target.value))}
                            className="w-full border border-slate-300 rounded-lg p-1 text-[11px] font-bold"
                          />
                        </div>
                        <div className="text-[9px] text-indigo-700 font-extrabold bg-indigo-50 px-1.5 py-1 rounded border border-indigo-100/50 flex-shrink-0 self-center">
                          e스쿨 {day.eschoolHours}h
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-400 font-black block mb-0.5">교시 상세정보 (수정 가능)</label>
                      <input 
                        type="text" 
                        value={day.periodInfo}
                        onChange={(e) => handleModalDailyDetailChange(index, 'periodInfo', e.target.value)}
                        placeholder="예: 3교시 조퇴"
                        className="w-full border border-slate-300 rounded-lg p-1.5 text-[11px] font-semibold bg-white"
                      />
                    </div>
                  </div>
                ))}

                <button 
                  type="button"
                  onClick={() => {
                    let nextDateStr = '2026-05-01';
                    if (modalDailyDetails.length > 0) {
                      const lastDate = new Date(modalDailyDetails[modalDailyDetails.length - 1].date);
                      lastDate.setDate(lastDate.getDate() + 1);
                      nextDateStr = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}-${String(lastDate.getDate()).padStart(2, '0')}`;
                    }
                    const defaultHours = getDefaultMissingHoursForDate(nextDateStr);
                    setModalDailyDetails([...modalDailyDetails, {
                      date: nextDateStr,
                      attendanceType: defaultHours > 0 ? '조퇴' : '결석',
                      missingHours: defaultHours,
                      eschoolHours: calculateEschoolHours(defaultHours),
                      periodInfo: defaultHours > 0 ? `${defaultHours}교시 조퇴` : '종일결석'
                    }]);
                  }}
                  className="w-full py-2 border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-xl text-slate-500 hover:text-indigo-600 font-bold text-xs transition flex items-center justify-center gap-1 bg-slate-50"
                >
                  <Plus className="w-4 h-4" />
                  <span>일정 추가하기</span>
                </button>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => {
                    setShowAddEventModal(false);
                    setOcrPrefilled(null);
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2.5 rounded-xl transition"
                >
                  취소
                </button>
                <button 
                  type="submit" 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition"
                >
                  캘린더 스케줄 배정 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Draft Generator (High-Fidelity Official Document Template MATCHED) */}
      {showDraftModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-slate-200/50">
            <div className="bg-gradient-to-r from-purple-700 to-indigo-700 text-white px-6 py-4 flex items-center justify-between">
              <h4 className="font-extrabold text-sm flex items-center gap-2">
                <FileText className="w-5 h-5 text-yellow-300 animate-bounce" />
                <span>기안 결재 공문서 미리보기 (5월 월말 정산 종합)</span>
              </h4>
              <button onClick={() => setShowDraftModal(false)} className="text-white/80 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {(() => {
              const data = getMonthlyAggregatedData(draftStudentId, draftMonth);
              if (!data) return <p className="p-6 text-xs font-bold text-slate-400">데이터를 찾을 수 없습니다.</p>;

              const studentDetail = data.student;
              const dateDetails = data.details;

              // Separate leaves & early outs
              const leaves = dateDetails.filter(d => d.attendanceType === '결석');
              const earlyOuts = dateDetails.filter(d => d.attendanceType === '조퇴');
              const lates = dateDetails.filter(d => d.attendanceType === '지각');

              // Format dates string for early outs
              const formattedEarlyOuts = earlyOuts.map(d => {
                const dateObj = new Date(d.date);
                const month = dateObj.getMonth() + 1;
                const day = dateObj.getDate();
                return `${month}/${day}(${d.periodInfo || `${d.missingHours}교시`})`;
              }).join(', ');

              const formattedLeaves = leaves.map(d => {
                const dateObj = new Date(d.date);
                const month = dateObj.getMonth() + 1;
                const day = dateObj.getDate();
                return `${month}/${day}(인정결석)`;
              }).join(', ');

              const formattedLates = lates.map(d => {
                const dateObj = new Date(d.date);
                const month = dateObj.getMonth() + 1;
                const day = dateObj.getDate();
                return `${month}/${day}(인정지각)`;
              }).join(', ');

              const titleEvent = dateDetails[0]?.eventTitle || '학생선수 평일 연습 경기 및 리그 평일 경기 참가';

              const draftText = `제목  학생 선수 ${draftMonth}월 출석 인정(${studentDetail.gradeClass} ${studentDetail.number}번 ${studentDetail.name})

「${studentDetail.sport} 선수로 등록되어 활동 중인 학생의 ${draftMonth}월 출석을 다음과 같이 인정하고자 합니다.」

1. 대상 : ${studentDetail.gradeClass} ${studentDetail.number}번 ${studentDetail.name}
2. 인정기간 :
${earlyOuts.length > 0 ? `   - 인정조퇴 : ${formattedEarlyOuts}` : ''}
${leaves.length > 0 ? `   - 인정결석 : ${formattedLeaves}` : ''}
${lates.length > 0 ? `   - 인정지각 : ${formattedLates}` : ''}
3. 사유 : ${titleEvent}
4. 증빙서류 : 학생선수 활동 보고서, e-school 학습확인서 등

붙임 1. LEO FC 평일 연습경기 참가에 따른 시간 할애 협조 요청 건 1부.
     2. 2026 중등축구리그 평일 경기 참가에 따른 시간 할애 요청 건 1부.
     3. ${draftMonth}월 학생선수활동보고서 1부.
     4. ${draftMonth}월 e-school 학습확인서 1부.  끝.`;

              return (
                <div className="p-6 space-y-4">
                  <div className="bg-indigo-50 text-indigo-950 p-3.5 rounded-xl border border-indigo-100 text-xs font-semibold leading-relaxed">
                    선생님께서 원하신 **수정된 기안문 본문 구성**입니다. 이 내용을 나이스(NEIS) 결재 상신 본문에 바로 복사하여 상신 처리하세요.
                  </div>

                  <textarea 
                    readOnly
                    rows={13}
                    className="w-full border border-slate-300 rounded-xl p-4 text-xs font-mono leading-relaxed bg-slate-50 focus:ring-0 focus:border-slate-300 text-slate-800"
                    value={draftText}
                  />

                  <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                    <button 
                      onClick={() => setShowDraftModal(false)}
                      className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2.5 rounded-xl transition"
                    >
                      닫기
                    </button>
                    <button 
                      onClick={() => {
                        const tempEl = document.createElement('textarea');
                        tempEl.value = draftText;
                        document.body.appendChild(tempEl);
                        tempEl.select();
                        document.execCommand('copy');
                        document.body.removeChild(tempEl);
                        
                        showToast("5월 종합 출석 기안서 본문이 정상 복사되었습니다. 나이스에 바로 붙여넣기 하세요!");
                        setShowDraftModal(false);
                      }}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition flex items-center gap-1.5"
                    >
                      <Copy className="w-4 h-4" />
                      <span>기안문 양식 복사</span>
                    </button>
                  </div>
                </div>
              );
            })()}

          </div>
        </div>
      )}

      {/* Canva-inspired minimal footer */}
      <footer className="bg-slate-900 text-slate-400 text-xs py-8 px-6 mt-12 border-t border-slate-800">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-extrabold text-slate-200">담임용 학생 선수 관리 원격 지원 포털</p>
            <p className="mt-1">© 2026 Homeroom Athlete Manager. All rights reserved.</p>
            <p className="mt-1 text-[10px] text-slate-500 font-medium">
              개인정보보호책임자: 홍민아 교사 (우신중학교) | 문의: 02-2610-1621 (교무실 내선)
            </p>
          </div>
          <div className="flex items-center gap-6 font-bold">
            <a href="https://ms.e-school.or.kr/main.do" target="_blank" rel="noopener noreferrer" className="hover:text-white transition flex items-center gap-1">
              <span>e-school 바로가기</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <span onClick={() => setShowTermsModal(true)} className="hover:text-white transition cursor-pointer">이용약관</span>
            <span onClick={() => setShowPrivacyModal(true)} className="hover:text-white transition cursor-pointer text-indigo-400">개인정보처리방침</span>
          </div>
        </div>
      </footer>

      {/* MODAL: Terms of Service */}
      {showTermsModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-slate-200/50 flex flex-col max-h-[85vh]">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
              <h4 className="font-extrabold text-sm flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" />
                <span>학생선수관리 웹앱 서비스 이용약관</span>
              </h4>
              <button onClick={() => setShowTermsModal(false)} className="text-white/80 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto text-xs text-slate-600 space-y-4 leading-relaxed font-sans text-left">
              <p className="font-bold text-slate-800">본 이용약관(이하 '약관')은 학생선수관리 웹앱(이하 '본 서비스')이 제공하는 교육용 웹 애플리케이션 서비스의 이용에 관한 사항을 규정합니다.</p>
              
              <hr className="border-slate-100" />
              
              <div>
                <h5 className="font-bold text-slate-800 mb-1">제1조 (목적)</h5>
                <p>이 약관은 개발 교사(이하 '서비스 제공자')가 제공하는 무료 교육용 웹 애플리케이션 서비스(이하 '서비스')를 이용함에 있어, 서비스 제공자와 이용자(학생, 학부모, 교사 등)의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제2조 (정의)</h5>
                <p>1. '서비스'란 본 플랫폼에서 제공하는 학생선수 출결 현황 추적, e-school 이수시간 점검 및 나이스(NEIS) 기안문 본문 빌더를 포함한 교육용 웹 애플리케이션 일체를 말합니다.</p>
                <p>2. '이용자'란 본 서비스에 접속하여 이 약관에 따라 서비스를 이용하는 회원(학생, 교사) 및 비회원을 말합니다.</p>
                <p>3. '회원'이란 본 서비스에 가입하여 계정을 생성한 자로서, 서비스를 이용할 수 있는 권한을 가진 자를 말합니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제3조 (약관의 명시와 개정)</h5>
                <p>1. 서비스 제공자는 이 약관의 내용을 이용자가 쉽게 알 수 있도록 서비스 초기 화면 또는 하단 링크에 게시합니다.</p>
                <p>2. 서비스 제공자는 관련 법령을 위배하지 않는 범위에서 이 약관을 개정할 수 있습니다.</p>
                <p>3. 약관을 개정할 경우에는 적용일자 및 개정사유를 명시하여 적용일 7일 이전부터 서비스 내에 공지합니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제4조 (서비스의 제공 및 요금)</h5>
                <p>1. 본 서비스는 학교 현장의 학생선수 관리를 지원하기 위한 목적으로 개발된 <strong>무료 교육용 서비스</strong>입니다.</p>
                <p>2. 서비스 이용과 관련하여 어떠한 유료 결제나 광고 유치가 발생하지 않으며, 상업적 목적으로 운영되지 않습니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제5조 (서비스의 중단)</h5>
                <p>1. 서비스 제공자는 시스템 점검, 서버 교체 및 고장, 네트워크 통신 두절 등의 기술적 사유가 발생한 경우에는 서비스 제공을 일시적으로 중단할 수 있습니다.</p>
                <p>2. 본 서비스는 공익 목적의 무료 교육용 서비스이므로, 서비스 중단이나 오류로 인한 별도의 보상이나 손해배상 책임은 제공하지 않습니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제6조 (회원가입 및 제한)</h5>
                <p>1. 이용자는 본 서비스가 정한 가입 절차에 따라 이름, 학번, 운동 종목 등의 정보를 정확히 입력하고 이 약관에 동의함으로써 가입을 신청합니다.</p>
                <p>2. 만 14세 미만의 아동(초등학생 및 중학생 일부)은 학기 초 배부된 학교 가정통신문 등을 통해 보호자(법정대리인)의 동의 절차를 완료한 후 본 서비스를 이용해야 합니다.</p>
                <p>3. 타인의 이름이나 학번을 도용하여 가입을 신청한 경우, 계정이 강제 삭제되거나 서비스 이용이 차단될 수 있습니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제7조 (이용자의 의무)</h5>
                <p>이용자는 본 서비스를 이용할 때 다음 각 호의 행위를 하여서는 안 됩니다.</p>
                <p>1. 회원 가입 또는 정보 변경 시 허위 내용을 등록하는 행위</p>
                <p>2. 타인의 계정 정보(아이디/비밀번호)를 무단으로 사용하여 로그인하거나 도용하는 행위</p>
                <p>3. 서비스 내에 다른 학생의 개인정보를 동의 없이 게시하거나 불법적으로 유출하는 행위</p>
                <p>4. 서비스의 정상적인 운영을 방해하거나 서버에 과도한 부하를 주는 행위</p>
                <p>5. 본 서비스를 교육용 목적 이외의 상업적 용도로 사용하는 행위</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제8조 (책임 제한 및 면책)</h5>
                <p>1. 본 서비스는 교육 지원을 위한 무료 도구로 제공되는 것이며, 서비스 제공자는 서비스의 완벽한 무결성이나 데이터의 영구 보존을 보장하지 않습니다.</p>
                <p>2. 이용자는 중요한 학생선수 활동 내역 및 증빙 서류 사본을 본인의 기기나 서류철에 별도로 보관하는 것을 적극 권장합니다.</p>
                <p>3. 서비스 제공자는 이용자가 서비스를 이용하는 과정에서 발생한 데이터 유실, 오동작, 또는 기안문 오작성으로 인한 행정적 불이익 등에 대해 고의나 중과실이 없는 한 책임지지 않습니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제9조 (분쟁의 해결)</h5>
                <p>본 서비스 이용과 관련하여 제공자와 이용자 간에 발생한 분쟁에 대해서는 대한민국의 관련 법령을 적용하며, 관할 법원은 서비스 제공자(개발 교사) 소속 학교 소재지의 관할 법원(서울남부지방법원)으로 합니다.</p>
              </div>

              <hr className="border-slate-100" />
              
              <p className="text-slate-400 text-[10px]">이 약관은 2026년 3월 1일부터 시행됩니다.</p>
            </div>
            
            <div className="bg-slate-50 px-6 py-4 flex justify-end border-t border-slate-100 shrink-0">
              <button 
                onClick={() => setShowTermsModal(false)}
                className="bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition"
              >
                동의 및 닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Privacy Policy */}
      {showPrivacyModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden border border-slate-200/50 flex flex-col max-h-[85vh]">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
              <h4 className="font-extrabold text-sm flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-indigo-400" />
                <span>학생선수관리 웹앱 개인정보처리방침</span>
              </h4>
              <button onClick={() => setShowPrivacyModal(false)} className="text-white/80 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto text-xs text-slate-600 space-y-4 leading-relaxed font-sans text-left">
              <p className="font-bold text-slate-800">학생선수관리 웹앱(이하 '본 서비스')은 개인정보 보호법 제30조에 따라 정보주체의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 하기 위하여 다음과 같이 개인정보 처리방침을 수립·공개합니다.</p>
              
              <hr className="border-slate-100" />
              
              <div>
                <h5 className="font-bold text-slate-800 mb-1">제1조 (개인정보의 처리 목적)</h5>
                <p>본 서비스는 다음의 목적을 위하여 최소한의 개인정보를 처리합니다.</p>
                <p>1. <strong>학생 회원 가입 및 관리:</strong> 학급 및 운동부 구성원 식별, 학사 결손 및 e-school 이수율 현황 확인, 담당 교사의 피드백 제공.</p>
                <p>2. <strong>출석인정 기안문 자동 생성:</strong> 월말 출결 및 이수 데이터를 기반으로 한 나이스(NEIS) 제출용 기안문 빌드.</p>
                <p>3. <strong>증빙서류 및 학습 이력 관리:</strong> 활동보고서, e-school 확인서 등의 수합 내역 관리.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제2조 (처리하는 개인정보 항목)</h5>
                <p>1. <strong>수집 항목:</strong> 아이디, 비밀번호, 이름, 학년, 반, 번호, 소속 운동 종목, 결석/조퇴/지각 세부 내역 및 이수율, 제출 증빙 서류명</p>
                <p>2. <strong>비수집 항목:</strong> 주민등록번호, 주소, 보호자 연락처 등 민감 정보</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제3조 (개인정보의 처리 및 보유기간)</h5>
                <p>보유 기간은 해당 학년도 종료 시(익년 2월 말) 또는 회원이 직접 탈퇴를 요청할 때까지이며, 보유 목적 달성 시 지체 없이 파기합니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제4조 (만 14세 미만 아동의 개인정보 처리에 관한 사항)</h5>
                <p>초/중학생 등 만 14세 미만 이용자는 학기 초 배부되는 학교 가정통신문(동의서)을 통해 법정대리인의 동의를 득한 뒤 서비스를 이용하여야 합니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제5조 (개인정보의 파기 절차 및 방법)</h5>
                <p>파기 사유 발생 시 데이터베이스에서 영구 삭제(DB 영구 삭제)하여 어떠한 형태로도 재생할 수 없도록 파기합니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제6조 (개인정보의 안전성 확보조치)</h5>
                <p>1. 이용자의 비밀번호는 <strong>단방향 해시 함수로 암호화</strong>되어 복호화가 불가능하게 저장됩니다.</p>
                <p>2. 전 구간 <strong>HTTPS 암호화 통신</strong>을 적용해 안전하게 데이터를 송수신합니다.</p>
                <p>3. 전문 보안 표준을 따르는 Google Firebase 및 Vercel 플랫폼을 통해 물리적으로 안전하게 데이터가 격리됩니다.</p>
                <p>4. <strong>AI 기안문 비식별화 전송 조치:</strong> 외부 AI(Gemini) API를 사용해 기안문을 생성할 때, 학생 이름 및 학년/반 등 실 식별 정보는 임시 식별자(`[학생 성명]`, `[학년반]` 등)로 변환(비식별화)한 후 서버로 전송하며, 결과 텍스트가 사용자의 기기에 도달한 후에 브라우저 내에서 안전하게 다시 실명으로 복원합니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제7조 (권리·의무 및 행사방법)</h5>
                <p>학생선수 및 법정대리인은 언제든지 열람, 정정, 삭제 요청이 가능하며 서비스 내 탈퇴 기능 혹은 책임 교사에게 연락해 처리할 수 있습니다.</p>
              </div>

              <div>
                <h5 className="font-bold text-slate-800 mb-1">제8조 (개인정보 보호책임자)</h5>
                <p>이름: 홍민아 (개발자) | 소속: 우신중학교 | 직위: 교사 | 연락처: 02-2610-1621(교무실)</p>
              </div>

              <hr className="border-slate-100" />
              
              <p className="text-slate-400 text-[10px]">이 개인정보 처리방침은 2026년 3월 1일부터 적용됩니다.</p>
            </div>
            
            <div className="bg-slate-50 px-6 py-4 flex justify-end border-t border-slate-100 shrink-0">
              <button 
                onClick={() => setShowPrivacyModal(false)}
                className="bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}
