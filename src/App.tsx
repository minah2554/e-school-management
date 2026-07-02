import React, { useState, useEffect } from 'react';
import { 
  Calendar, Users, FileText, CheckCircle, UploadCloud, AlertTriangle, 
  Plus, Trash2, BookOpen, Sparkles, Clock, Check, 
  ChevronLeft, ChevronRight, File, Info, Copy, Settings, RefreshCw, X,
  ExternalLink, ChevronDown, CheckSquare, Square, Download, Share2
} from 'lucide-react';

// Firebase Modules for future cloud upgrade (Standard Rules Guard applied)
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
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
const sanitizeFileName = (fileName: string, studentsList: any[]): string => {
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
  if (studentsList && Array.isArray(studentsList)) {
    studentsList.forEach(student => {
      const studentName = student.name;
      if (studentName && studentName.length >= 2) {
        const masked = studentName[0] + '*'.repeat(studentName.length - 2) + studentName[studentName.length - 1];
        const escapedStudentName = studentName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(escapedStudentName, 'g');
        name = name.replace(regex, masked);
      }
    });
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

// --- Student Name Anonymization Helper ---
const maskStudentName = (name: string): string => {
  if (!name) return '';
  if (name.length <= 1) return name;
  if (name.length === 2) {
    return name[0] + 'O';
  }
  const first = name[0];
  const last = name[name.length - 1];
  const middleLen = name.length - 2;
  return first + 'O'.repeat(middleLen) + last;
};

// e-school hours: 1~2 hours -> 1 hour, 3+ hours -> 2 hours (Max 2 hours/day)
const calculateEschoolHours = (hours: number) => {
  const num = Number(hours);
  if (isNaN(num) || num <= 0) return 0;
  if (num <= 2) return 1;
  return 2;
};

// --- Clean Event Title Helper to truncate administrative terms ---
const cleanEventTitle = (fileName: string, studentsList: any[] = []): string => {
  if (!fileName) return '';
  let title = fileName.replace(/\.[^/.]+$/, ""); // Remove file extension
  
  // 1. Remove brackets and parenthetical contents
  title = title.replace(/\([\s\S]*?\)/g, "");
  title = title.replace(/\[[\s\S]*?\]/g, "");
  title = title.replace(/\{[\s\S]*?\}/g, "");
  title = title.replace(/[\(\)\[\]\{\}]/g, ""); // strip unmatched ones

  // 2. Remove numbers and month labels (e.g., "5월", "12")
  title = title.replace(/\d+월/g, "");
  title = title.replace(/\d+/g, "");

  // 3. Strip student names
  if (studentsList && Array.isArray(studentsList)) {
    studentsList.forEach(s => {
      if (s.name) {
        const cleanName = s.name.replace(/\s+/g, '');
        title = title.replace(new RegExp(cleanName, 'g'), '');
        title = title.replace(new RegExp(s.name, 'g'), '');
      }
    });
  }

  // 4. Truncate at common administrative keywords
  const keywords = [
    "에 따른", 
    "참가에", 
    "협조", 
    "요청", 
    "시간할애", 
    "시간 할애", 
    "공문", 
    "출석 인정", 
    "출석인정", 
    "건$", 
    "발송"
  ];
  
  for (const keyword of keywords) {
    const index = title.indexOf(keyword);
    if (index !== -1) {
      title = title.substring(0, index);
    }
  }

  // Remove trailing/leading spaces, punctuation or dashes
  title = title.trim().replace(/^[-_~:\s]+/, "").replace(/[-_~:\s]+$/, "").trim();

  return title || "대회/훈련 참가";
};

// --- Robust JSON extraction helper from LLM response ---
const extractJsonFromText = (text: string): any => {
  if (!text) throw new Error("AI 응답이 빈 데이터입니다.");
  
  // strip single-line and multi-line comments
  const cleanComments = (str: string) => {
    return str
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(?:^|[^:])\/\/.*$/gm, '');
  };

  // Try to find content between ```json and ```
  const mdMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (mdMatch && mdMatch[1]) {
    try {
      return JSON.parse(cleanComments(mdMatch[1]));
    } catch (e) {}
  }
  
  // Try to find content between ``` and ```
  const codeMatch = text.match(/```\s*([\s\S]*?)\s*```/);
  if (codeMatch && codeMatch[1]) {
    try {
      return JSON.parse(cleanComments(codeMatch[1]));
    } catch (e) {}
  }
  
  // Fallback to finding first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = text.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(cleanComments(jsonCandidate));
    } catch (e) {}
  }
  
  throw new Error("올바른 JSON 구조를 찾을 수 없습니다.");
};

// --- Robust date parsing helper to ensure standard YYYY-MM-DD format ---
const parseToStandardDate = (dateStr: string): string => {
  if (!dateStr) return '2026-05-01';
  let clean = dateStr.replace(/\s+/g, '');
  
  // YYYY년MM월DD일 또는 MM월DD일
  const koMatch = clean.match(/(?:(\d{4})년)?(\d{1,2})월(\d{1,2})일/);
  if (koMatch) {
    const y = koMatch[1] || '2026';
    const m = koMatch[2].padStart(2, '0');
    const d = koMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  
  // YYYY-MM-DD 또는 MM-DD 또는 YYYY/MM/DD 또는 MM/DD
  const dashMatch = clean.match(/(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})/);
  if (dashMatch) {
    const y = dashMatch[1] || '2026';
    const m = dashMatch[2].padStart(2, '0');
    const d = dashMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // YYYY.MM.DD 또는 MM.DD 또는 YYYY.MM.DD. (끝에 점이 있는 경우 포함)
  const dotMatch = clean.match(/(?:(\d{4}|\d{2})\.)?(\d{1,2})\.(\d{1,2})\.?/);
  if (dotMatch) {
    let y = dotMatch[1] || '2026';
    if (y.length === 2) {
      y = '20' + y;
    }
    const m = dotMatch[2].padStart(2, '0');
    const d = dotMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  
  return dateStr;
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

  const createDefaultDayDetail = (dateStr: string) => {
    const d = new Date(dateStr);
    const dayOfWeek = d.getDay();
    const totalPeriods = (dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) ? 6 : (dayOfWeek === 2 || dayOfWeek === 4) ? 7 : 6;
    
    // Default to 4교시 조퇴 (Attends 1-4 periods, misses remaining)
    const defaultPeriod = 4;
    const hours = Math.max(0, totalPeriods - defaultPeriod);
    
    return {
      date: dateStr,
      attendanceType: '조퇴',
      missingHours: hours,
      eschoolHours: calculateEschoolHours(hours),
      periodInfo: `${defaultPeriod}교시 조퇴`
    };
  };

  if (days.length > 0) {
    days.forEach(day => {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      dailyDetails.push(createDefaultDayDetail(dateStr));
    });
  } else {
    // Default 4 days fallback if no dates found in name
    const defaultDays = [7, 12, 14, 26];
    defaultDays.forEach(day => {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      dailyDetails.push(createDefaultDayDetail(dateStr));
    });
  }

  // Find start and end dates
  const sortedDetails = [...dailyDetails].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const startDate = sortedDetails[0]?.date || `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = sortedDetails[sortedDetails.length - 1]?.date || `${year}-${String(month).padStart(2, '0')}-31`;

  // Find matching student by checking if any student name is in the filename (ignoring whitespace)
  const cleanFileName = fileName.replace(/\s+/g, '');
  let matchedStudent = students.find(s => {
    const cleanName = s.name.replace(/\s+/g, '');
    return cleanFileName.includes(cleanName) || cleanName.includes(cleanFileName);
  });
  
  let studentId = matchedStudent ? matchedStudent.id : '';
  
  if (!studentId) {
    const nameMatch = fileName.match(/([가-힣]{3})/);
    if (nameMatch) {
      const parsedName = nameMatch[1];
      const exists = students.find(s => s.name.replace(/\s+/g, '') === parsedName);
      if (exists) {
        studentId = exists.id;
      }
    }
  }
  
  if (!studentId) {
    studentId = students[0]?.id || '';
  }

  const sanitizedName = sanitizeFileName(fileName, students);

  let rawTitle = cleanEventTitle(fileName, students);
  rawTitle = rawTitle.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  let title = rawTitle;
  if (!title.includes(`${month}월`)) {
    title = `${month}월 ${title}`;
  }
  if (title === `${month}월 대회/훈련 참가` || title === `${month}월 대회/훈련`) {
    title = `${month}월 평일 훈련`;
  }

  return {
    title,
    studentId,
    type: '평일 연습 경기 및 중등리그 참가',
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
    type: '평일 연습 경기 및 중등리그 참가',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    dailyDetails: [
      { date: '2026-05-07', missingHours: 3, eschoolHours: 2, attendanceType: '조퇴', periodInfo: '4교시 조퇴' },
      { date: '2026-05-12', missingHours: 0, eschoolHours: 0, attendanceType: '조퇴', periodInfo: '7교시 조퇴' },
      { date: '2026-05-14', missingHours: 3, eschoolHours: 2, attendanceType: '조퇴', periodInfo: '4교시 조퇴' },
      { date: '2026-05-26', missingHours: 0, eschoolHours: 0, attendanceType: '조퇴', periodInfo: '7교시 조퇴' }
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
    type: '평일 연습 경기 및 중등리그 참가', 
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
  const [selectedEventToEdit, setSelectedEventToEdit] = useState<any>(null);
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
  const [showOnlyEvents, setShowOnlyEvents] = useState(false);

  // Toast notification state
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  // OCR Simulator state
  const [ocrScanning, setOcrScanning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrPrefilled, setOcrPrefilled] = useState<any>(null);
  const [ocrHint, setOcrHint] = useState('');

  // Dynamic daily details inside schedule creator
  const [modalDailyDetails, setModalDailyDetails] = useState<any[]>([]);

  // Controlled modal form inputs
  const [modalTitle, setModalTitle] = useState('');
  const [modalStudentId, setModalStudentId] = useState('stud_image_data');
  const [modalType, setModalType] = useState('평일 연습 경기 및 중등리그 참가');
  const [modalIsException, setModalIsException] = useState(false);

  // Dynamic history of event types (reasons)
  const eventTypeHistory = Array.from(new Set([
    '평일 연습 경기 및 중등리그 참가',
    '상시 훈련 참가',
    ...events.map(e => e.type).filter(Boolean)
  ]));

  // Sync modal inputs when ocrPrefilled changes
  useEffect(() => {
    if (ocrPrefilled) {
      setModalTitle(ocrPrefilled.title || '');
      setModalStudentId(ocrPrefilled.studentId || (students[0]?.id || 'stud_image_data'));
      setModalType(ocrPrefilled.type || '평일 연습 경기 및 중등리그 참가');
      setModalIsException(ocrPrefilled.isExceptionEvent || false);
      if (ocrPrefilled.dailyDetails) {
        setModalDailyDetails(ocrPrefilled.dailyDetails);
      }
    } else {
      setModalTitle('');
      setModalStudentId(students[0]?.id || 'stud_image_data');
      setModalType('평일 연습 경기 및 중등리그 참가');
      setModalIsException(false);
    }
  }, [ocrPrefilled, students]);


  // --- Firebase Auth & Load ---
  useEffect(() => {
    let unsubscribeUser = () => {};
    
    if (isFirebaseAvailable) {
      unsubscribeUser = onAuthStateChanged(auth, (authUser) => {
        if (authUser) {
          setUser(authUser);
        } else {
          setUser(null);
        }
        setLoading(false);
      });
    } else {
      const cachedUser = localStorage.getItem('sam_mock_user');
      if (cachedUser) {
        setUser(JSON.parse(cachedUser));
      } else {
        setUser(null);
        setLoading(false);
      }
    }

    return () => unsubscribeUser();
  }, []);

  // --- Local Storage User Scoped Load ---
  useEffect(() => {
    if (!isFirebaseAvailable) {
      if (user) {
        const studentsKey = `sam_students_${user.uid}`;
        const eventsKey = `sam_events_${user.uid}`;
        const localStudents = localStorage.getItem(studentsKey);
        const localEvents = localStorage.getItem(eventsKey);
        
        if (localStudents) {
          setStudents(JSON.parse(localStudents));
        } else {
          setStudents(INITIAL_STUDENTS);
          localStorage.setItem(studentsKey, JSON.stringify(INITIAL_STUDENTS));
        }

        if (localEvents) {
          setEvents(JSON.parse(localEvents));
        } else {
          setEvents(INITIAL_EVENTS);
          localStorage.setItem(eventsKey, JSON.stringify(INITIAL_EVENTS));
        }
      } else {
        setStudents([]);
        setEvents([]);
      }
      setLoading(false);
    }
  }, [user]);

  const handleGoogleLogin = async () => {
    if (isFirebaseAvailable && auth) {
      try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
        showToast("구글 계정으로 로그인되었습니다.");
      } catch (e: any) {
        console.error("Google Sign-In failed", e);
        showToast("구글 로그인에 실패했습니다: " + e.message, "error");
      }
    } else {
      // Mock Google Login in Local Mode
      const mockUser = {
        uid: 'mock-google-teacher',
        displayName: '홍민아 교사',
        email: 'minah.hong@school.egov.kr',
        photoURL: 'https://api.dicebear.com/7.x/adventurer/svg?seed=minah'
      };
      setUser(mockUser);
      localStorage.setItem('sam_mock_user', JSON.stringify(mockUser));
      showToast("로컬 모드: 홍민아 교사 계정으로 로그인되었습니다.");
    }
  };

  const handleLogout = async () => {
    if (isFirebaseAvailable && auth) {
      try {
        await signOut(auth);
        setUser(null);
        showToast("로그아웃 되었습니다.");
      } catch (e: any) {
        console.error("Sign-Out failed", e);
      }
    } else {
      setUser(null);
      localStorage.removeItem('sam_mock_user');
      showToast("로그아웃 되었습니다.");
    }
  };

  // --- Fetching from Firestore if User Active ---
  useEffect(() => {
    if (!isFirebaseAvailable || !user) return;
    setLoading(true);

    const studentsRef = collection(db, 'artifacts', appId, 'teachers', user.uid, 'students');
    const eventsRef = collection(db, 'artifacts', appId, 'teachers', user.uid, 'events');

    // Subscribe to students
    const unsubscribeStudents = onSnapshot(studentsRef, (snapshot) => {
      let studList: any[] = [];
      snapshot.forEach((doc) => {
        studList.push({ id: doc.id, ...doc.data() });
      });
      if (studList.length === 0) {
        // Initialize Firebase with defaults if empty
        INITIAL_STUDENTS.forEach(async (stud) => {
          await setDoc(doc(db, 'artifacts', appId, 'teachers', user.uid, 'students', stud.id), stud);
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
          await setDoc(doc(db, 'artifacts', appId, 'teachers', user.uid, 'events', evt.id), evt);
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

    const updatedList = [...students, newStudent];
    setStudents(updatedList);
    const studentsKey = user ? `sam_students_${user.uid}` : 'sam_students';
    localStorage.setItem(studentsKey, JSON.stringify(updatedList));

    if (isFirebaseAvailable && db && user) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'teachers', user.uid, 'students', newStudent.id), newStudent);
      } catch (e) {
        console.error("Firebase save failed", e);
      }
    }
    showToast(`${name} 학생선수가 성공적으로 등록되었습니다.`);
    setShowAddStudentModal(false);
  };

  const handleUpdateStudent = async (studentId: string, updatedFields: any) => {
    const updated = students.map(s => s.id === studentId ? { ...s, ...updatedFields } : s);
    setStudents(updated);
    const studentsKey = user ? `sam_students_${user.uid}` : 'sam_students';
    localStorage.setItem(studentsKey, JSON.stringify(updated));

    if (isFirebaseAvailable && db && user) {
      try {
        const studentDocRef = doc(db, 'artifacts', appId, 'teachers', user.uid, 'students', studentId);
        await updateDoc(studentDocRef, updatedFields);
      } catch (e) {
        console.error("Firebase update failed", e);
      }
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

    const updatedList = [...events, eventWithId];
    setEvents(updatedList);
    const eventsKey = user ? `sam_events_${user.uid}` : 'sam_events';
    localStorage.setItem(eventsKey, JSON.stringify(updatedList));

    if (isFirebaseAvailable && db && user) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'teachers', user.uid, 'events', eventId), eventWithId);
      } catch (e) {
        console.error("Firebase event save failed", e);
      }
    }
    showToast("새 훈련/경기 일정이 캘린더에 성공적으로 자동 배정되었습니다.");
    setShowAddEventModal(false);
  };

  const handleUpdateEvent = async (eventId: string, updatedFields: any) => {
    const oldEvent = events.find(e => e.id === eventId);
    if (!oldEvent) return;

    const newEvent = { ...oldEvent, ...updatedFields };

    // 1. Revert old student stats
    if (!oldEvent.isExceptionEvent) {
      const oldStudent = students.find(s => s.id === oldEvent.studentId);
      if (oldStudent) {
        let totalAbsences = 0;
        let totalHours = 0;
        oldEvent.dailyDetails.forEach((day: any) => {
          if (day.attendanceType === '결석') totalAbsences += 1;
          else totalHours += Number(day.missingHours || 0);
        });

        let rawHours = (oldStudent.usedDays * 6 + oldStudent.accumulatedHours) - (totalAbsences * 6 + totalHours);
        if (rawHours < 0) rawHours = 0;
        const restoredDays = Math.floor(rawHours / 6);
        const restoredHours = rawHours % 6;

        await handleUpdateStudent(oldStudent.id, {
          usedDays: restoredDays,
          accumulatedHours: restoredHours
        });
      }
    }

    // 2. Apply new student stats
    if (!newEvent.isExceptionEvent) {
      const newStudent = students.find(s => s.id === newEvent.studentId);
      if (newStudent) {
        let totalNewAbsences = 0;
        let totalNewHours = 0;
        newEvent.dailyDetails.forEach((day: any) => {
          if (day.attendanceType === '결석') totalNewAbsences += 1;
          else totalNewHours += Number(day.missingHours || 0);
        });

        let baseDays = newStudent.usedDays;
        let baseHours = newStudent.accumulatedHours;
        if (oldEvent.studentId === newEvent.studentId && !oldEvent.isExceptionEvent) {
          let totalAbsences = 0;
          let totalHours = 0;
          oldEvent.dailyDetails.forEach((day: any) => {
            if (day.attendanceType === '결석') totalAbsences += 1;
            else totalHours += Number(day.missingHours || 0);
          });
          let rawHours = (newStudent.usedDays * 6 + newStudent.accumulatedHours) - (totalAbsences * 6 + totalHours);
          if (rawHours < 0) rawHours = 0;
          baseDays = Math.floor(rawHours / 6);
          baseHours = rawHours % 6;
        }

        const newAccumulatedHours = baseHours + totalNewHours;
        const convertedDays = Math.floor(newAccumulatedHours / 6);
        const remainingHours = newAccumulatedHours % 6;
        const updatedDays = baseDays + totalNewAbsences + convertedDays;

        await handleUpdateStudent(newStudent.id, {
          usedDays: Math.min(35, updatedDays),
          accumulatedHours: remainingHours
        });
      }
    }

    // 3. Update events list
    const updatedList = events.map(e => e.id === eventId ? newEvent : e);
    setEvents(updatedList);
    const eventsKey = user ? `sam_events_${user.uid}` : 'sam_events';
    localStorage.setItem(eventsKey, JSON.stringify(updatedList));

    if (isFirebaseAvailable && db && user) {
      try {
        await setDoc(doc(db, 'artifacts', appId, 'teachers', user.uid, 'events', eventId), newEvent);
      } catch (e) {
        console.error("Firebase event update failed", e);
      }
    }

    showToast("일정이 성공적으로 수정되었습니다.");
    setShowAddEventModal(false);
    setSelectedEventToEdit(null);
  };

  const openEditModal = (evt: any) => {
    setSelectedEventToEdit(evt);
    setModalTitle(evt.title);
    setModalStudentId(evt.studentId);
    setModalType(evt.type);
    setModalIsException(evt.isExceptionEvent);
    setModalDailyDetails(evt.dailyDetails || []);
    setShowAddEventModal(true);
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

    const filtered = events.filter(e => e.id !== eventId);
    setEvents(filtered);
    const eventsKey = user ? `sam_events_${user.uid}` : 'sam_events';
    localStorage.setItem(eventsKey, JSON.stringify(filtered));

    if (isFirebaseAvailable && db && user) {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'teachers', user.uid, 'events', eventId));
      } catch (e) {
        console.error("Firebase event delete failed", e);
      }
    }
    showToast("일정이 정상적으로 삭제되었습니다.", "info");
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

    const updated = events.map(e => e.id === eventId ? { ...e, checklist: updatedChecklist, files: updatedFiles } : e);
    setEvents(updated);
    const eventsKey = user ? `sam_events_${user.uid}` : 'sam_events';
    localStorage.setItem(eventsKey, JSON.stringify(updated));

    if (isFirebaseAvailable && db && user) {
      try {
        await updateDoc(doc(db, 'artifacts', appId, 'teachers', user.uid, 'events', eventId), {
          checklist: updatedChecklist,
          files: updatedFiles
        });
      } catch (e) {
        console.error("Firebase checklist update failed", e);
      }
    }
    showToast(`${checkKey === 'neisInput' ? '나이스 출결' : checkKey === 'eschoolAssigned' ? 'e-school 배정확인' : checkKey === 'reportSubmitted' ? '활동보고서 수합' : '이수확인서 수합'} 상태가 토글되었습니다.`);
  };

  const handleFileUpload = async (eventId: string, fileKey: string, fileName: string) => {
    const targetEvent = events.find(e => e.id === eventId);
    if (!targetEvent) return;

    // Sanitize filename to protect student's privacy
    const sanitizedName = sanitizeFileName(fileName, students);

    const updatedFiles = { ...targetEvent.files, [fileKey]: sanitizedName };
    const updatedChecklist = { ...targetEvent.checklist };
    
    if (fileKey === 'report') updatedChecklist.reportSubmitted = true;
    if (fileKey === 'cert') updatedChecklist.certSubmitted = true;
    if (fileKey === 'document') updatedChecklist.neisInput = true;

    const updated = events.map(e => e.id === eventId ? { ...e, files: updatedFiles, checklist: updatedChecklist } : e);
    setEvents(updated);
    const eventsKey = user ? `sam_events_${user.uid}` : 'sam_events';
    localStorage.setItem(eventsKey, JSON.stringify(updated));

    if (isFirebaseAvailable && db && user) {
      try {
        await updateDoc(doc(db, 'artifacts', appId, 'teachers', user.uid, 'events', eventId), {
          files: updatedFiles,
          checklist: updatedChecklist
        });
      } catch (e) {
        console.error("Firebase file upload map failed", e);
      }
    }
    showToast(`${sanitizedName} 파일이 성공적으로 매핑되었습니다.`);
  };

  // --- Smart OCR Document Parser via Gemini Multimodal API ---
  const triggerOcrSimulation = async (file: File, userHint?: string) => {
    if (!file) return;

    // Check duplicate document based on raw and sanitized name comparison
    const isDuplicate = events.some(evt => {
      const sanitizedFile = sanitizeFileName(file.name, students);
      return evt.uploadedDocName === file.name || 
             evt.files?.document === file.name ||
             evt.uploadedDocName === sanitizedFile ||
             evt.files?.document === sanitizedFile;
    });

    if (isDuplicate) {
      const confirmUpload = window.confirm(
        `이미 동일한 이름으로 등록된 공문(혹은 파일)이 존재합니다.\n그래도 다시 분석하여 일정을 등록하시겠습니까?\n\n(※ 확인을 누르시면 새로 일정을 검수하고 캘린더에 배정할 수 있습니다.)`
      );
      if (!confirmUpload) {
        return;
      }
    }

    setOcrScanning(true);
    setOcrProgress(10);

    const isImageOrPdf = file.type.startsWith('image/') || file.type === 'application/pdf';
    
    // Progress bar tick interval
    const interval = setInterval(() => {
      setOcrProgress((prev) => {
        if (prev >= 90) {
          return 90; // Wait at 90% while serverless API is resolving
        }
        return prev + 15;
      });
    }, 150);

    // Fallback executor in case of errors or non-image/pdf documents
    const runFallback = async (isError = false) => {
      clearInterval(interval);
      setOcrProgress(100);
      
      const parsedData = parseOcrFromFilename(file.name, students);
      let targetStudentId = parsedData.studentId;

      // Extract 3-char Korean name from filename to see if we can create a temp student
      const nameMatch = file.name.match(/([가-힣]{3})/);
      if (nameMatch) {
        const parsedName = nameMatch[1];
        const exists = students.find(s => s.name.replace(/\s+/g, '') === parsedName);
        if (exists) {
          targetStudentId = exists.id;
        } else {
          const newTempStudent = {
            id: `temp_stud_${Date.now()}`,
            name: parsedName,
            sport: '축구',
            gradeClass: '2학년 2반',
            number: '99',
            usedDays: 0,
            accumulatedHours: 0,
            runUpStatus: {},
            isTemporary: true
          };
          setStudents(prev => [...prev, newTempStudent]);
          targetStudentId = newTempStudent.id;
          showToast(`새로운 학생 선수 '${parsedName}'를 파일명에서 자동 식별하여 추가 등록했습니다.`, "info");
        }
      }
      
      const sanitizedName = sanitizeFileName(file.name, students);
      const prefilledData = {
        ...parsedData,
        studentId: targetStudentId,
        uploadedDocName: sanitizedName,
        files: {
          document: sanitizedName,
          report: '',
          cert: ''
        },
        checklist: {
          neisInput: true,
          eschoolAssigned: false,
          reportSubmitted: false,
          certSubmitted: false
        }
      };

      setTimeout(() => {
        setOcrScanning(false);
        setOcrPrefilled(prefilledData);
        setModalDailyDetails(prefilledData.dailyDetails);
        setShowAddEventModal(true);
        if (isError) {
          window.alert("⚠ 공문 AI 분석에 실패하여 파일명 기반 대체 데이터로 구성되었습니다.\n\n상세한 일정을 직접 검수하여 입력해 주세요.");
          showToast("공문 AI 분석 실패: 파일명 기반 대체 데이터로 구성되었습니다.", "error");
        } else {
          window.alert("🎉 파일명을 기반으로 공문 정보 분석이 완료되었습니다!\n\n일정 검수 및 추가 등록 창에서 상세 정보를 최종 확인하고 배정해 주세요.");
          showToast("공문 정보 분석 완료. 일정을 검수해 주세요.");
        }
      }, 300);
    };

    const isHwpx = file.name.endsWith('.hwpx');
    if (!isImageOrPdf && !isHwpx) {
      // For other non-image/pdf/hwpx documents (e.g. .hwp, .docx), trigger immediately name-based parsing
      runFallback();
      return;
    }

    try {
      // 1. Read file as Base64 Data URL
      const reader = new FileReader();
      const fileDataPromise = new Promise<{ base64: string, mimeType: string }>((resolve, reject) => {
        reader.onload = () => {
          const result = reader.result as string;
          const commaIdx = result.indexOf(',');
          const base64 = result.substring(commaIdx + 1);
          const mimeType = file.name.endsWith('.hwpx') ? 'application/zip' : (file.type || 'application/pdf');
          resolve({ base64, mimeType });
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
      });

      const { base64, mimeType } = await fileDataPromise;

      // 2. Build detailed prompt for Gemini to structure JSON output
      const studentNamesList = students.map(s => s.name).join(', ');
      let prompt = `너는 학교 행정 및 출석 인정 공문서 분석 전문가이다.
다음 첨부된 공문(대회/훈련 협조요청 공문서 또는 관련 기안서/보고서)을 정밀 스캔하여 아래의 정보들을 아주 상세하고 정확하게 추출해줘. 
다양한 형태의 한국 공문서 서식을 인식해야 하며, 양식이 다르더라도 최상의 정확도로 아래의 정보를 뽑아내야 한다.

[매우 중요 - 현재 등록된 학생 선수 명단]
- 현재 등록된 학생 이름 목록: [ ${studentNamesList} ]
- 공문 내에서 학생 이름을 찾을 때, 이 목록에 포함된 이름이 공문에 등장한다면 그 이름을 가장 최우선적으로 매치시켜 studentName으로 추출하시오. (예: '김진우'가 명단에 있고 공문에 '김진우' 또는 '김 진 우'가 적혀있다면 '김진우'를 추출)
- 교사, 교장, 교감, 기안자, 수신자, 감독, 코치 등 '학생 선수'가 아닌 이름은 절대 studentName으로 추출하지 마십시오.

[추출 항목 및 세부 규칙]
1. 대회 또는 훈련에 참가한 학생 선수 이름 (studentName)
   - 문서 본문, 수신처, 또는 첨부 문서의 테이블(명단)에서 학생 이름을 정확히 찾으시오.
   - 이름 사이에 공백이 있는 경우(예: '김 현 우' 또는 '홍 길 동') 공백을 완전히 제외한 순수 이름(예: '김진우', '홍길동')으로 합쳐서 추출하시오.
   - 만약 여러 명의 학생이 기재되어 있다면 가장 주가 되는 학생 또는 첫 번째로 식별된 학생 이름을 한 명만 추출하시오.

2. 운동 종목 (sport)
   - 공문서 내 언급된 축구, 야구, 농구 등의 종목을 추출하시오. 식별이 안 될 경우 공문명이나 문맥상 추정되는 종목을 쓰고 기본값은 '축구'로 설정하시오.

3. 공식 대회 또는 훈련의 정식 명칭 (eventTitle)
   - 불필요한 행정 문구나 결재선 정보, 학생 이름은 제외하고 "[X월] [소속/상대팀/대회명/목적] [훈련/경기/참가]" 형태로 요약하시오.
   - 예: '7월 레오 FC 평일 훈련 참가', '6월 천안시티 연습경기', '7월 전국소년체전 참가' 등. 개인정보는 제목에 포함하지 마시오.

4. 사유 및 일정 구분 명칭 (eventTypeLabel)
   - 공문에 구체적으로 명시된 참가 사유(예: "평일 훈련 참가", "평일 연습 경기 및 중등리그 참가", "전국소년체육대회 참가" 등)를 한줄로 명시하시오.

5. 세부 출석인정 일정 리스트 (dailyDetails)
   - 공문에 명시된 모든 결석, 조퇴, 지각 날짜와 교시 정보를 빠짐없이 배열로 나열해야 한다.
   
[날짜 범위 및 표(Table/그리드) 추출 규칙 - 누락 방지를 위한 초정밀 스캔 필수]
   - 공문서 하단이나 본문에 **표(Table/그리드)나 바둑판 형태의 칸**으로 날짜들이 여러 열과 행에 걸쳐 배치되어 있다면, **단 하나의 칸(셀)도 빠뜨리지 말고 왼쪽에서 오른쪽, 위에서 아래로 모든 일정을 순차적으로 다 스캔**해야 한다.
   - 예를 들어, 표 내부에 '7월 2일(목요일)', '7월 7일(화요일)', '7월 9일(목요일)', '7월 14일(화요일)', '7월 16일(목요일)', '7월 21일(화요일)', '7월 23일(목요일)' 같이 7개의 날짜가 격자 형태로 나뉘어 배치되어 있다면, 절대 3~4개만 추출해서는 안 되며 **반드시 7개 모두 개별 날짜별 객체로 변환하여 dailyDetails 리스트에 포함**해야 한다.
   - 공문에 일정이 기간 형태로 명시된 경우(예: '5월 12일(화) ~ 15일(금)'), 그 사이에 들어가는 모든 평일/개별 날짜(12일, 13일, 14일, 15일)를 각각 하나의 독립된 일별 객체로 쪼개어 dailyDetails 리스트에 추가해야 한다. 주말(토, 일)은 제외한다.
   - 공문에 쉼표나 슬래시로 날짜가 나열된 경우 (예: '5/7, 5/12, 5/14, 5/26'), 각각의 날짜를 전부 개별 객체로 변환하시오.
   
[연도 및 요일 매핑 정합성 규칙]
   - 올해 연도는 **2026년**이다. 연도가 표시되지 않은 날짜는 무조건 2026년으로 매핑하시오.
   - 날짜(date)는 반드시 'YYYY-MM-DD' 형식이어야 한다.
   - 공문에 명시된 요일(예: '7월 2일(목요일)')이 실제 2026년 달력 기준의 요일과 맞는지 교차 검증하시오. 2026년 7월 2일은 목요일이 맞으므로 '2026-07-02'로 정확히 매핑해야 한다.

[인정 유형 및 시수/교시 매핑 규칙]
   - 인정유형(attendanceType)은 '결석', '조퇴', '지각' 중 하나로만 정확히 분류하시오.
   - 공문 내용에 **'6교시 후 조퇴'** 또는 **'6교시 조퇴'**라는 조건이 명시되어 있다면, 추출되는 모든 날짜 일정의 인정유형은 '조퇴'로, periodInfo는 '6교시 조퇴'로, missingHours는 1로 일관되게 적용하여 리스트를 만드시오.
   - 결석(종일 인정결석):
     * 하루 종일 참여하거나 별도 교시 지정이 없는 출석인정의 경우 '결석'으로 처리하고, missingHours는 6(혹은 7)으로 입력하시오. periodInfo는 '종일결석'으로 설정하시오.
   - 조퇴:
     * 공문에 특정 교시 이후 조퇴나 시간 할애 등이 명시된 경우(예: '4교시 후 조퇴', '13:00 이후(4교시 후)', '5교시부터 조퇴'), attendanceType은 '조퇴'로 하고, periodInfo는 'N교시 조퇴' (예: '4교시 조퇴')로 기록하며, missingHours는 [총 수업 시수 - N]교시만큼을 계산하시오. (단, 조퇴 교시 정보만 적어두면 아래 시스템에서 시수를 자동 보정하므로, periodInfo에 'N교시 조퇴'를 정확히 기입하는 것이 가장 중요합니다.)
   - 지각:
     * 특정 교시 지각 시 attendanceType은 '지각', periodInfo는 'N교시 지각', missingHours는 1로 설정하시오.`;

      if (userHint) {
        prompt += `\n\n[사용자 추가 힌트 (가장 우선 반영)]
- 사용자가 직접 입력한 힌트: "${userHint}"
- 만약 사용자가 적어준 힌트에 학생 이름이나 날짜 범위, 유형 정보가 있다면, 공문서 내용보다 이 힌트를 최우선 조건으로 반영하여 최종 JSON 데이터를 뽑아내시오.`;
      }

      prompt += `\n\n반드시 다른 군더더기 설명이나 마크다운 코드블록(\`\`\`json) 기호 등도 포함하지 말고, 오직 아래의 JSON 포맷 텍스트 하나만 출력하시오:

{
  "studentName": "학생 이름",
  "sport": "종목",
  "eventTitle": "대회/훈련명 요약",
  "eventTypeLabel": "사유 및 일정 구분 명칭",
  "dailyDetails": [
    {
      "date": "YYYY-MM-DD",
      "attendanceType": "결석|조퇴|지각",
      "missingHours": 6,
      "periodInfo": "종일결석|N교시 조퇴|N교시 지각"
    }
  ]
}`;

      // 3. Dispatch POST request to serverless endpoint
      const res = await fetch('/api/gemini-counseling', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt, fileData: { base64, mimeType } })
      });

      if (!res.ok) {
        throw new Error('API server error');
      }

      const result = await res.json();
      const rawText = result.text || '';
      
      const parsedJson = extractJsonFromText(rawText);
      
      // Assign targetType directly to the parsed label
      let targetType = '평일 연습 경기 및 중등리그 참가';
      if (parsedJson.eventTypeLabel) {
        targetType = parsedJson.eventTypeLabel.trim();
      }

      // 4. Map parsed student name to register student ID (ignoring whitespace)
      let matchedStudent = null;
      let targetStudentId = '';
      
      if (parsedJson.studentName) {
        const cleanParsed = parsedJson.studentName.replace(/\s+/g, '');
        matchedStudent = students.find(s => {
          const cleanName = s.name.replace(/\s+/g, '');
          return cleanName === cleanParsed || cleanName.includes(cleanParsed) || cleanParsed.includes(cleanName);
        });
      }

      if (matchedStudent) {
        targetStudentId = matchedStudent.id;
      } else if (parsedJson.studentName) {
        // Automatically create a temporary student option
        const tempName = parsedJson.studentName.replace(/\s+/g, '');
        const newTempStudent = {
          id: `temp_stud_${Date.now()}`,
          name: parsedJson.studentName.trim(),
          sport: parsedJson.sport || '축구',
          gradeClass: '2학년 2반',
          number: '99',
          usedDays: 0,
          accumulatedHours: 0,
          runUpStatus: {},
          isTemporary: true
        };
        setStudents(prev => [...prev, newTempStudent]);
        targetStudentId = newTempStudent.id;
        showToast(`새로운 학생 선수 '${newTempStudent.name}'를 공문에서 자동 식별하여 추가 등록했습니다.`, "info");
      } else {
        targetStudentId = students[0]?.id || '';
      }
      
      // 5. Sanitize and Correct dailyDetails (Preventing 0-hour or 0-period errors)
      const sanitizedDetails = (parsedJson.dailyDetails || []).map((day: any) => {
        const dateStr = parseToStandardDate(day.date);
        const d = new Date(dateStr);
        const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        
        // Standard missing hours per weekday (Mon/Wed/Fri = 6, Tue/Thu = 7, Sat/Sun = 0)
        let totalHours = 6;
        if (dayOfWeek === 2 || dayOfWeek === 4) {
          totalHours = 7;
        } else if (dayOfWeek === 0 || dayOfWeek === 6) {
          totalHours = 0;
        }

        let type = day.attendanceType || '조퇴';
        if (type !== '결석' && type !== '조퇴' && type !== '지각') {
          type = '조퇴';
        }

        let hours = Number(day.missingHours);
        let info = day.periodInfo || '';

        if (type === '결석') {
          hours = totalHours;
          info = '종일결석';
        } else if (type === '지각') {
          hours = 1;
          info = '1교시 지각';
        } else {
          // 조퇴인 경우
          // 1. periodInfo에서 조퇴 교시 숫자(P) 추출 시도
          let matchedPeriod = 0;
          const matchResult = info.match(/(\d+)교시/);
          if (matchResult) {
            matchedPeriod = parseInt(matchResult[1], 10);
          }

          if (matchedPeriod > 0 && totalHours > 0) {
            // 조퇴 교시가 명시된 경우 결손 시수 = 총수업시수 - 조퇴교시
            hours = totalHours - matchedPeriod;
            if (hours < 0) hours = 0;
          } else {
            // 조퇴 교시가 없고 missingHours만 제공된 경우
            if (isNaN(hours) || hours < 0) {
              hours = 1; // 기본 1시간 결손
            }
          }

          // 2. 조퇴 교시(P) 라벨링 보정
          const targetPeriod = totalHours - hours;
          if (totalHours > 0 && targetPeriod > 0) {
            info = `${targetPeriod}교시 조퇴`;
          } else {
            info = info || '조퇴';
          }
        }

        return {
          date: dateStr,
          attendanceType: type,
          missingHours: hours,
          eschoolHours: calculateEschoolHours(hours),
          periodInfo: info
        };
      });

      const sanitizedName = sanitizeFileName(file.name, students);
      const parsedData = {
        title: parsedJson.eventTitle || cleanEventTitle(file.name),
        studentId: targetStudentId,
        type: targetType,
        startDate: sanitizedDetails[0]?.date || '2026-05-01',
        endDate: sanitizedDetails[sanitizedDetails.length - 1]?.date || '2026-05-31',
        isExceptionEvent: false,
        dailyDetails: sanitizedDetails,
        uploadedDocName: sanitizedName,
        files: {
          document: sanitizedName,
          report: '',
          cert: ''
        },
        checklist: {
          neisInput: true,
          eschoolAssigned: false,
          reportSubmitted: false,
          certSubmitted: false
        }
      };

      clearInterval(interval);
      setOcrProgress(100);
      setTimeout(() => {
        setOcrScanning(false);
        setOcrPrefilled(parsedData);
        setModalDailyDetails(parsedData.dailyDetails);
        setShowAddEventModal(true);
        window.alert("🎉 공문 분석이 성공적으로 완료되었습니다!\n\n일정 검수 및 추가 등록 창에서 상세 내역(날짜, 인정 유형, 교시 등)을 최종 확인한 후 배정해 주세요.");
        showToast("공문 분석이 완료되었습니다. 일정을 확인한 후 배정해 주세요.");
      }, 300);

    } catch (err) {
      console.warn("AI OCR parser error, fallback initiated:", err);
      runFallback(true);
    }
  };

  // --- Dynamic modal daily details change handlers ---
  const handleModalDailyDetailChange = (index: number, field: string, value: any) => {
    const updated = [...modalDailyDetails];
    const current = { ...updated[index], [field]: value };
    
    const dateStr = current.date;
    const d = new Date(dateStr);
    const day = d.getDay(); // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
    const totalPeriods = (day === 1 || day === 3 || day === 5) ? 6 : (day === 2 || day === 4) ? 7 : 6;

    if (field === 'date') {
      if (current.attendanceType === '결석') {
        current.missingHours = totalPeriods;
        current.periodInfo = '종일결석';
      } else {
        const match = current.periodInfo.match(/(\d+)교시/);
        const periodVal = match ? parseInt(match[1], 10) : null;
        if (periodVal && periodVal > 0) {
          const newHours = totalPeriods - periodVal;
          current.missingHours = newHours >= 0 ? newHours : 0;
        } else {
          current.missingHours = Math.min(current.missingHours, totalPeriods);
          current.periodInfo = `${totalPeriods - current.missingHours}교시 ${current.attendanceType}`;
        }
      }
      current.eschoolHours = calculateEschoolHours(current.missingHours);
    }
    
    else if (field === 'attendanceType') {
      if (value === '결석') {
        current.missingHours = totalPeriods;
        current.periodInfo = '종일결석';
      } else {
        const periodVal = 4;
        const newHours = totalPeriods - periodVal;
        current.missingHours = newHours >= 0 ? newHours : 0;
        current.periodInfo = `${periodVal}교시 ${value}`;
      }
      current.eschoolHours = calculateEschoolHours(current.missingHours);
    }
    
    else if (field === 'missingHours') {
      const numHours = Number(value);
      current.missingHours = numHours;
      current.eschoolHours = calculateEschoolHours(numHours);
      if (current.attendanceType !== '결석') {
        const periodVal = totalPeriods - numHours;
        if (periodVal > 0) {
          current.periodInfo = `${periodVal}교시 ${current.attendanceType}`;
        } else {
          current.periodInfo = `${totalPeriods}교시 ${current.attendanceType}`;
        }
      }
    }
    
    else if (field === 'periodInfo') {
      const match = value.match(/(\d+)교시/);
      const parsedPeriod = match ? parseInt(match[1], 10) : parseInt(value.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(parsedPeriod) && parsedPeriod >= 0) {
        const newHours = totalPeriods - parsedPeriod;
        current.missingHours = newHours >= 0 ? newHours : 0;
      }
      current.eschoolHours = calculateEschoolHours(current.missingHours);
    }

    updated[index] = current;
    setModalDailyDetails(updated);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white">
        <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin mb-4" />
        <p className="text-sm font-bold tracking-wider">시스템 로딩 중...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-950 flex flex-col items-center justify-center p-4">
        {renderToast()}
        <div className="bg-white/10 backdrop-blur-xl p-8 rounded-3xl border border-white/20 shadow-2xl max-w-md w-full text-center space-y-6 animate-in fade-in duration-300">
          <div className="flex justify-center">
            <div className="bg-white/15 p-4 rounded-2xl border border-white/20 shadow-inner">
              <Sparkles className="w-10 h-10 text-white animate-pulse" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black tracking-tight text-white">학생선수 스마트 행정 관리</h2>
            <p className="text-xs text-indigo-200 font-medium">나이스 출결 자동 계산 및 e-school 실시간 추적 포털</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-left text-xs text-indigo-100/90 leading-relaxed space-y-2">
            <p className="font-bold text-yellow-300">💡 로그인 안내</p>
            <p>• 학교 행정 업무 처리를 위해 구글 연동 계정으로 로그인해 주세요.</p>
            <p>• 최초 로그인 시 학교 소속 인증 및 권한 확인 단계가 진행됩니다.</p>
          </div>
          <button 
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-100 text-slate-900 font-extrabold text-sm py-3.5 px-5 rounded-xl shadow-lg hover:shadow-xl transition transform active:scale-95 duration-100 cursor-pointer"
          >
            <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
              <g transform="matrix(1, 0, 0, 1, 0, 0)">
                <path d="M21.35,11.1H12v2.7h5.38c-0.24,1.28 -0.96,2.37 -2.05,3.1l3.2,2.48c1.87,-1.72 2.97,-4.27 2.97,-7.22C21.5,11.83 21.45,11.45 21.35,11.1z" fill="#4285F4" />
                <path d="M12,20.5c2.57,0 4.71,-0.85 6.29,-2.32l-3.2,-2.48c-0.89,0.6 -2.02,0.95 -3.09,0.95c-2.38,0 -4.39,-1.61 -5.11,-3.77l-3.3,2.56C5.17,18.43 8.35,20.5 12,20.5z" fill="#34A853" />
                <path d="M6.89,12.88c-0.18,-0.54 -0.29,-1.11 -0.29,-1.7c0,-0.59 0.11,-1.16 0.29,-1.7L3.59,6.92C2.86,8.38 2.5,10.09 2.5,11.88c0,1.79 0.36,3.5 1.09,4.96L6.89,12.88z" fill="#FBBC05" />
                <path d="M12,5.88c1.4,0 2.65,0.48 3.64,1.43l2.72,-2.72C16.71,3.06 14.57,2.25 12,2.25c-3.65,0 -6.83,2.07 -8.41,5.08l3.3,2.56C7.61,7.49 9.62,5.88 12,5.88z" fill="#EA4335" />
              </g>
            </svg>
            <span>Google 계정으로 로그인</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {renderToast()}

      {/* Canva-inspired sleek header */}
      <header className="bg-gradient-to-r from-violet-600 via-indigo-600 to-indigo-700 text-white sticky top-0 z-40 px-6 py-4 flex flex-wrap items-center justify-between gap-4 shadow-lg shadow-indigo-100">
        <div className="flex items-center gap-3">
          <div className="bg-white/10 backdrop-blur-md text-white p-2.5 rounded-xl border border-white/20 shadow-inner">
            <Sparkles className="w-6 h-6 text-white animate-pulse" />
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

          {/* Google Profile Badge & Logout */}
          <div className="flex items-center gap-2 bg-black/15 px-3 py-1.5 rounded-xl border border-white/10 backdrop-blur-md">
            {user?.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || 'User'} className="w-5 h-5 rounded-full border border-white/20" />
            ) : (
              <div className="w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center text-[10px] font-black text-white">
                {(user?.displayName || '교').substring(0, 1)}
              </div>
            )}
            <span className="text-xs font-black text-white truncate max-w-[80px]">{user?.displayName || '담임교사'}님</span>
            <button 
              onClick={handleLogout}
              className="text-[9px] text-indigo-200 hover:text-white font-extrabold bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded transition cursor-pointer"
            >
              로그아웃
            </button>
          </div>

          <div className="flex bg-black/15 p-1 rounded-xl border border-white/10 backdrop-blur-md">
            <button 
              onClick={() => setActiveTab('dashboard')} 
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-black transition-all cursor-pointer ${activeTab === 'dashboard' ? 'bg-white text-indigo-900 shadow-sm' : 'text-indigo-100 hover:text-white'}`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>일정</span>
            </button>
            <button 
              onClick={() => setActiveTab('students')} 
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-black transition-all ${activeTab === 'students' ? 'bg-white text-indigo-900 shadow-sm' : 'text-indigo-100 hover:text-white'}`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>학생 명단 ({totalStudents})</span>
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
              <span className="text-2xl font-black text-rose-600">{pendingChecklists}건 발생</span>
            </div>
            <div className="bg-rose-50 text-rose-600 p-3 rounded-2xl">
              <AlertTriangle className="w-6 h-6 animate-pulse" />
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
              <p className="text-[11px] text-indigo-200 mb-3">공문서 이미지/PDF를 올리면 일정을 자동 분류합니다.</p>
              
              {/* Optional Prompt/Hint Input Box */}
              <div className="mb-3">
                <input 
                  type="text" 
                  value={ocrHint}
                  onChange={(e) => setOcrHint(e.target.value)}
                  placeholder="💡 분석 힌트 입력 (예: 학생명 김진우, 7/2~7/5 결석)" 
                  className="w-full bg-white/10 hover:bg-white/15 border border-white/20 rounded-xl px-3 py-2 text-xs text-white placeholder-indigo-300 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition"
                />
              </div>

              <label className="bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl px-3 py-1.5 cursor-pointer text-xs font-bold transition flex items-center justify-center gap-1.5 w-full">
                <UploadCloud className="w-4 h-4" />
                <span>공문 업로드 및 분석 시작</span>
                <input 
                  type="file" 
                  accept=".pdf,image/*,.hwp,.docx" 
                  className="hidden" 
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      triggerOcrSimulation(file, ocrHint);
                      // Clear hint after upload
                      setOcrHint('');
                    }
                    e.target.value = ''; // Reset value to allow re-uploading the same file
                  }}
                />
              </label>
              <p className="text-[9px] text-indigo-300 mt-2 flex items-center gap-1">
                <span>🔒 개인정보 보호: 업로드된 파일은 일회성 암호화 전송을 통해 AI로 분석되며 분석 완료 즉시 완전히 소멸됩니다.</span>
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

              {/* 보기 모드 선택기 */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl">
                  <button
                    onClick={() => setShowOnlyEvents(false)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                      !showOnlyEvents 
                        ? 'bg-white text-indigo-900 shadow-sm font-black' 
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    달력형 보기
                  </button>
                  <button
                    onClick={() => setShowOnlyEvents(true)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                      showOnlyEvents 
                        ? 'bg-white text-indigo-900 shadow-sm font-black' 
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    이벤트 있는 일정만 보기 (모바일 권장)
                  </button>
                </div>
              </div>

              {showOnlyEvents ? (
                /* 모바일 및 간소화용 이벤트 리스트 보기 */
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                  {(() => {
                    const daysInMonth = getDaysInMonth(currentDate);
                    const activeDays: any[] = [];
                    
                    for (let d = 1; d <= daysInMonth; d++) {
                      const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const dayEvents = getEventsForDate(dateStr);
                      if (dayEvents.length > 0) {
                        activeDays.push({
                          dayNum: d,
                          dateStr,
                          dayEvents
                        });
                      }
                    }

                    if (activeDays.length === 0) {
                      return (
                        <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400">
                          <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                          <p className="text-xs font-bold">이번 달에 예정된 학사 결손 및 대회 참가가 없습니다.</p>
                        </div>
                      );
                    }

                    return activeDays.map(({ dayNum, dateStr, dayEvents }) => {
                      const dObj = new Date(dateStr);
                      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
                      const dayName = dayNames[dObj.getDay()];
                      const isSunday = dObj.getDay() === 0;
                      const isSaturday = dObj.getDay() === 6;

                      return (
                        <div 
                          key={dateStr}
                          className="bg-white border border-slate-200 hover:border-slate-300 p-4 rounded-2xl transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
                        >
                          <div className="flex items-center gap-3 shrink-0">
                            <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center border font-black text-center shrink-0 ${
                              isSunday ? 'bg-rose-50 border-rose-100 text-rose-600' :
                              isSaturday ? 'bg-indigo-50 border-indigo-100 text-indigo-600' :
                              'bg-slate-50 border-slate-200 text-slate-700'
                            }`}>
                              <span className="text-[9px] leading-none uppercase">{dayName}</span>
                              <span className="text-lg leading-none mt-0.5">{dayNum}</span>
                            </div>
                            <div>
                              <h4 className="font-extrabold text-sm text-slate-900">
                                {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월 {dayNum}일
                              </h4>
                              <p className="text-[10px] text-slate-400 font-bold">일정 {dayEvents.length}건 등록됨</p>
                            </div>
                          </div>

                          <div className="flex-1 flex flex-wrap gap-2">
                            {dayEvents.map((evt: any) => {
                              const student = students.find(s => s.id === evt.studentId);
                              const dayDetail = evt.dailyDetails?.find((d: any) => d.date === dateStr);
                              if (!dayDetail) return null;

                              return (
                                <div 
                                  key={evt.id} 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditModal(evt);
                                  }}
                                  className="bg-rose-50/20 hover:bg-rose-100/40 border border-slate-200 hover:border-slate-350 px-3 py-1.5 rounded-xl flex items-center gap-3 shadow-sm text-xs cursor-pointer transition"
                                >
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-black text-slate-900">{student ? maskStudentName(student.name) : '학생'}</span>
                                      <span className="text-[9px] text-slate-400 font-semibold">{student?.gradeClass}</span>
                                    </div>
                                    <p className="text-[9px] text-slate-500 font-bold leading-normal truncate max-w-[150px]" title={evt.title}>
                                      {evt.title}
                                    </p>
                                  </div>
                                  
                                  <div className="flex items-center gap-2 shrink-0 border-l border-slate-200 pl-2">
                                    <span className="text-xs font-black text-rose-600 bg-rose-100/80 px-1.5 py-0.5 rounded">
                                      {dayDetail.missingHours}h
                                    </span>
                                    {dayDetail.eschoolHours > 0 && (
                                      <span className="text-[9px] bg-indigo-100/80 text-indigo-900 border border-indigo-300 px-1.5 py-0.5 rounded-lg font-black shadow-inner">
                                        e스쿨: {dayDetail.eschoolHours}시간
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          <button 
                            onClick={() => {
                              setSelectedDateEvents(dayEvents);
                              if (dayEvents.length > 0) {
                                openEditModal(dayEvents[0]);
                              }
                            }}
                            className="text-[11px] font-black bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 px-3 py-2 rounded-xl transition self-end sm:self-center cursor-pointer"
                          >
                            일정 선택
                          </button>
                        </div>
                      );
                    });
                  })()}
                </div>
              ) : (
                /* 표준 7열 달력 그리드 보기 */
                <>
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
                          onClick={() => {
                            setSelectedDateEvents(dayEvents);
                            if (dayEvents.length > 0) {
                              openEditModal(dayEvents[0]);
                            }
                          }}
                          className={`h-24 p-1.5 rounded-xl border flex flex-col text-left transition relative group cursor-pointer ${
                            isCurrent 
                              ? 'border-indigo-600 bg-indigo-50/20 ring-2 ring-indigo-600/10' 
                              : 'border-slate-100 hover:border-slate-300 bg-white'
                          } ${dayEvents.length > 0 ? 'shadow-sm shadow-indigo-50/30' : ''}`}
                        >
                          <span className={`text-[10px] font-bold leading-none mb-1 inline-block p-1 rounded ${
                            isCurrent ? 'bg-indigo-600 text-white font-extrabold shadow-sm' : 'text-slate-600'
                          }`}>
                            {dayNum}
                          </span>

                          <div className="flex-1 overflow-y-auto space-y-1 scrollbar-none mt-1 w-full">
                            {dayEvents.slice(0, 2).map((evt: any) => {
                              const student = students.find(s => s.id === evt.studentId);
                              const dayDetail = evt.dailyDetails?.find((d: any) => d.date === dateStr);
                              if (!dayDetail) return null;

                              return (
                                <div 
                                  key={evt.id} 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditModal(evt);
                                  }}
                                  className="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-1 py-0.5 rounded text-[8.5px] font-black truncate w-full flex items-center justify-between gap-1 leading-none shadow-sm cursor-pointer"
                                >
                                  <span className="truncate shrink-0 max-w-[65%]">{student ? maskStudentName(student.name) : '학생'}</span>
                                  <span className="text-rose-600 bg-white/70 px-0.5 rounded text-[8px] font-black">
                                    {dayDetail.missingHours}h{dayDetail.eschoolHours > 0 ? `(e:${dayDetail.eschoolHours})` : ''}
                                  </span>
                                </div>
                              );
                            })}
                            {dayEvents.length > 2 && (
                              <div className="text-[8px] font-black text-indigo-700 bg-indigo-50 border border-indigo-150 px-1 py-0.5 rounded text-center leading-none">
                                +{dayEvents.length - 2}건 더보기
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Legends */}
              <div className="mt-5 flex flex-wrap items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200/60 text-xs text-slate-500 font-semibold">
                <span className="font-extrabold text-slate-700">색상 범례:</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-rose-50 border-l-4 border-rose-500 rounded-sm"></span> 결손 시간 (빨간색 & 시수 표시)</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-50 border border-emerald-250 rounded-sm"></span> e-school 배정 완료</span>
              </div>
            </div>

            {/* Selection Panel / Actions */}
            <div className="space-y-6">
              
              {/* 월간 행정 현황판 */}
              {(() => {
                const stats = getMonthlyStats();
                const totalTasks = stats.neisInput.total + stats.eschoolAssigned.total + stats.reportSubmitted.total + stats.certSubmitted.total;
                const completedTasks = stats.neisInput.done + stats.eschoolAssigned.done + stats.reportSubmitted.done + stats.certSubmitted.done;
                const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

                return (
                  <div className="bg-white p-6 rounded-2xl border border-indigo-100 shadow-xl shadow-indigo-50/50 space-y-5">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <div className="bg-indigo-50 text-indigo-600 p-2 rounded-xl">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-extrabold text-sm text-slate-900">
                            {currentDate.getMonth() + 1}월 행정 종합 현황판
                          </h4>
                          <p className="text-[10px] text-slate-400 font-bold">전체 문서 수합 및 확인 현황</p>
                        </div>
                      </div>
                      <span className="text-[9px] bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full font-black">실시간 연동</span>
                    </div>

                    {/* Completion Progress Bar */}
                    <div className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <div className="flex items-center justify-between text-xs font-extrabold">
                        <span className="text-slate-600">전체 행정 종결율</span>
                        <span className="text-indigo-600">{completionRate}% ({completedTasks}/{totalTasks} 완료)</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                        <div 
                          className="bg-indigo-600 h-full rounded-full transition-all duration-500" 
                          style={{ width: `${completionRate}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Core metrics grid */}
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="bg-indigo-50/50 border border-indigo-100 p-3 rounded-xl">
                        <span className="text-[10px] text-indigo-950/70 block font-bold">e-school 배정 시수</span>
                        <span className="text-2xl font-black text-indigo-900">{stats.totalEschoolHours}h</span>
                      </div>
                      <div className="bg-rose-50/50 border border-rose-100 p-3 rounded-xl">
                        <span className="text-[10px] text-rose-950/70 block font-bold">나이스 출결 입력</span>
                        <span className="text-2xl font-black text-rose-700">{stats.neisInput.done} / {stats.neisInput.total}</span>
                      </div>
                    </div>

                    {/* Detailed Task Checklist progress */}
                    <div className="space-y-3 pt-1">
                      <span className="text-[10px] text-slate-400 font-black block uppercase">세부 서류 수합 진행률</span>
                      
                      <div className="space-y-2.5">
                        {[
                          { label: "e-school 수강 배정", done: stats.eschoolAssigned.done, total: stats.eschoolAssigned.total, color: "bg-indigo-600" },
                          { label: "개인 활동보고서 수합", done: stats.reportSubmitted.done, total: stats.reportSubmitted.total, color: "bg-purple-600" },
                          { label: "이수확인증 최종 수합", done: stats.certSubmitted.done, total: stats.certSubmitted.total, color: "bg-emerald-600" }
                        ].map((item, index) => {
                          const rate = item.total > 0 ? Math.round((item.done / item.total) * 100) : 0;
                          return (
                            <div key={index} className="space-y-1">
                              <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                                <span>{item.label}</span>
                                <span>{item.done}/{item.total} ({rate}%)</span>
                              </div>
                              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div 
                                  className={`${item.color} h-full rounded-full`} 
                                  style={{ width: `${rate}%` }}
                                ></div>
                              </div>
                            </div>
                          );
                        })}
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
                      const defaultDate = '2026-05-15'; // Friday
                      const totalPeriods = 6; // Friday is 6 periods
                      const periodVal = 4;
                      const missingHours = totalPeriods - periodVal; // 2 hours
                      setModalDailyDetails([{
                        date: defaultDate,
                        attendanceType: '조퇴',
                        missingHours: missingHours,
                        eschoolHours: calculateEschoolHours(missingHours),
                        periodInfo: `${periodVal}교시 조퇴`
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
                            <div className="flex gap-2">
                              <button 
                                onClick={() => {
                                  setSelectedEventToEdit(evt);
                                  setModalTitle(evt.title);
                                  setModalStudentId(evt.studentId);
                                  setModalType(evt.type);
                                  setModalIsException(evt.isExceptionEvent);
                                  setModalDailyDetails(evt.dailyDetails || []);
                                  setShowAddEventModal(true);
                                }}
                                className="font-black text-slate-500 hover:text-indigo-600 flex items-center gap-1 cursor-pointer"
                              >
                                <Settings className="w-3.5 h-3.5" />
                                <span>수정</span>
                              </button>
                            </div>
                            <button 
                              onClick={() => {
                                setSelectedEvent(evt);
                                setActiveTab('eschool');
                              }}
                              className="font-black text-indigo-600 hover:underline flex items-center gap-0.5 cursor-pointer"
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
                  <h3 className="font-extrabold text-lg text-slate-900">학생선수 원격 명부</h3>
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
                                if (confirm(`${student.name} 학생선수를 학생 목록에서 지우시겠습니까?`)) {
                                  const filtered = students.filter(s => s.id !== student.id);
                                  setStudents(filtered);
                                  const studentsKey = user ? `sam_students_${user.uid}` : 'sam_students';
                                  localStorage.setItem(studentsKey, JSON.stringify(filtered));

                                  if (isFirebaseAvailable && db && user) {
                                    try {
                                      await deleteDoc(doc(db, 'artifacts', appId, 'teachers', user.uid, 'students', student.id));
                                    } catch (e) {
                                      console.error("Firebase delete failed", e);
                                    }
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
                              isAllCollected 
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                : 'bg-rose-50 text-rose-600 border border-rose-150 animate-pulse'
                            }`}>
                              {isAllCollected ? (
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                              ) : (
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 animate-bounce" />
                              )}
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
                <span>{selectedEventToEdit ? '경기 및 인정 조퇴/결석 세부 수정' : '경기 및 인정 조퇴/결석 세부 설계'}</span>
              </h4>
              <button 
                onClick={() => {
                  setShowAddEventModal(false);
                  setOcrPrefilled(null);
                  setSelectedEventToEdit(null);
                }} 
                className="text-white hover:text-white/80 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form 
              key={ocrPrefilled ? `prefill-${ocrPrefilled.studentId}-${ocrPrefilled.uploadedDocName || ''}` : 'new-event'}
              onSubmit={(e: any) => {
                e.preventDefault();
                const title = e.target.elements.title.value;
                const studentId = e.target.elements.studentId.value;
                const type = e.target.elements.type.value;
                const isExceptionEvent = e.target.elements.isExceptionEvent.checked;

                if (modalDailyDetails.length === 0) {
                  if (selectedEventToEdit) {
                    if (confirm("일자별 인정 시간 정보가 모두 삭제되었습니다. 이 일정을 전체 삭제하시겠습니까?")) {
                      handleDeleteEvent(selectedEventToEdit.id);
                      setShowAddEventModal(false);
                    }
                  } else {
                    alert("일자별 인정 시간 정보를 최소 1개 이상 등록해 주세요.");
                  }
                  return;
                }

                if (selectedEventToEdit) {
                  handleUpdateEvent(selectedEventToEdit.id, {
                    studentId,
                    title,
                    type,
                    startDate: startVal,
                    endDate: endVal,
                    dailyDetails: modalDailyDetails,
                    isExceptionEvent
                  });
                } else {
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
                      document: ocrPrefilled?.uploadedDocName || ocrPrefilled?.files?.document || '',
                      report: '',
                      cert: ''
                    }
                  });
                }

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
                    value={modalStudentId}
                    onChange={(e) => setModalStudentId(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white focus:ring-2 focus:ring-indigo-500"
                  >
                    {students.map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.sport})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">사유 및 일정구분</label>
                  <input 
                    type="text"
                    name="type" 
                    required 
                    value={modalType}
                    onChange={(e) => setModalType(e.target.value)}
                    placeholder="예: 평일 연습 경기 및 중등리그 참가"
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-xs bg-white focus:ring-2 focus:ring-indigo-500"
                  />
                  {eventTypeHistory.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                      {eventTypeHistory.slice(0, 5).map((hist, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setModalType(hist)}
                          className="text-[9px] font-black bg-slate-100 hover:bg-indigo-50 hover:text-indigo-650 text-slate-600 border border-slate-200 hover:border-indigo-200 px-2.5 py-0.5 rounded transition cursor-pointer"
                        >
                          {hist}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">공문 대회/훈련 사유 명칭</label>
                <input 
                  type="text" 
                  name="title" 
                  placeholder="예: 레오 FC 평일 연습 경기 및 2026 중등축구리그"
                  value={modalTitle}
                  onChange={(e) => setModalTitle(e.target.value)}
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
                    checked={modalIsException}
                    onChange={(e) => setModalIsException(e.target.checked)}
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

                    <div className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-4">
                        <label className="text-[10px] text-slate-400 font-black block mb-0.5">날짜</label>
                        <input 
                          type="date" 
                          value={day.date}
                          onChange={(e) => handleModalDailyDetailChange(index, 'date', e.target.value)}
                          className="w-full border border-slate-300 rounded-lg p-1.5 text-xs font-bold bg-white"
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="text-[10px] text-slate-400 font-black block mb-0.5">일정 구분</label>
                        <select 
                          value={day.attendanceType} 
                          onChange={(e) => handleModalDailyDetailChange(index, 'attendanceType', e.target.value)}
                          className="w-full border border-slate-300 rounded-lg p-1.5 text-xs bg-white font-bold"
                        >
                          <option value="조퇴">인정 조퇴</option>
                          <option value="결석">인정 결석</option>
                          <option value="지각">인정 지각</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10px] text-slate-400 font-black block mb-0.5">결손시수</label>
                        <input 
                          type="number" 
                          min="0" 
                          max="7" 
                          value={day.missingHours}
                          onChange={(e) => handleModalDailyDetailChange(index, 'missingHours', Number(e.target.value))}
                          className="w-full border border-slate-300 rounded-lg p-1.5 text-xs font-bold text-center bg-white"
                        />
                      </div>
                      <div className="col-span-3">
                        <label className="text-[10px] text-slate-400 font-black block mb-0.5">배정 시수</label>
                        <div className="w-full text-xs text-indigo-900 font-black bg-indigo-50 border border-indigo-200 px-2 py-1.5 rounded-lg text-center shadow-sm flex items-center justify-center min-h-[34px] leading-none">
                          e스쿨: <span className="text-[13px] text-indigo-700 font-black ml-1 underline decoration-indigo-300 decoration-2">{day.eschoolHours}시간</span>
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
                    const d = new Date(nextDateStr);
                    const day = d.getDay();
                    const totalPeriods = (day === 1 || day === 3 || day === 5) ? 6 : (day === 2 || day === 4) ? 7 : 6;
                    const isSchoolDay = day > 0 && day < 6;
                    
                    const attendanceType = isSchoolDay ? '조퇴' : '결석';
                    const periodVal = 4;
                    const missingHours = isSchoolDay ? (totalPeriods - periodVal) : totalPeriods;
                    const periodInfo = isSchoolDay ? `${periodVal}교시 조퇴` : '종일결석';

                    setModalDailyDetails([...modalDailyDetails, {
                      date: nextDateStr,
                      attendanceType,
                      missingHours,
                      eschoolHours: calculateEschoolHours(missingHours),
                      periodInfo
                    }]);
                  }}
                  className="w-full py-2 border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-xl text-slate-500 hover:text-indigo-600 font-bold text-xs transition flex items-center justify-center gap-1 bg-slate-50"
                >
                  <Plus className="w-4 h-4" />
                  <span>일정 추가하기</span>
                </button>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
                <div>
                  {selectedEventToEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("이 일정을 전체 삭제하시겠습니까?")) {
                          handleDeleteEvent(selectedEventToEdit.id);
                          setShowAddEventModal(false);
                        }
                      }}
                      className="flex items-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 hover:border-rose-300 font-extrabold text-xs px-3.5 py-2.5 rounded-xl transition cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>일정 전체 삭제</span>
                    </button>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <button 
                    type="button" 
                    onClick={() => {
                      setShowAddEventModal(false);
                      setOcrPrefilled(null);
                      setSelectedEventToEdit(null);
                    }}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs px-4 py-2.5 rounded-xl transition"
                  >
                    취소
                  </button>
                  <button 
                    type="submit" 
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition"
                  >
                    {selectedEventToEdit ? '수정 완료' : '캘린더 스케줄 배정 완료'}
                  </button>
                </div>
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

              // Format all dates in a single integrated chronological list
              const formattedAbsences = dateDetails.map(d => {
                const dateObj = new Date(d.date);
                const month = dateObj.getMonth() + 1;
                const day = dateObj.getDate();
                
                let detailLabel = '';
                if (d.attendanceType === '결석') {
                  detailLabel = '인정결석';
                } else if (d.attendanceType === '지각') {
                  detailLabel = '인정지각';
                } else {
                  detailLabel = d.periodInfo || `${d.missingHours}교시 조퇴`;
                }
                
                return `   - ${month}/${day} : ${detailLabel}`;
              }).join('\n');

              // Group days by eventTitle (Reason)
              const groupedReasons: { [reason: string]: string[] } = {};
              dateDetails.forEach(d => {
                const dateObj = new Date(d.date);
                const m = dateObj.getMonth() + 1;
                const dayVal = dateObj.getDate();
                const dateLabel = `${m}/${dayVal}`;
                const reason = d.eventTitle || '평일 연습 경기 및 리그 평일 경기 참가';
                
                if (!groupedReasons[reason]) {
                  groupedReasons[reason] = [];
                }
                groupedReasons[reason].push(dateLabel);
              });

              let reasonText = '';
              const reasonEntries = Object.entries(groupedReasons);
              if (reasonEntries.length === 1) {
                reasonText = reasonEntries[0][0];
              } else {
                reasonText = '\n' + reasonEntries.map(([reason, dates]) => {
                  return `   - ${reason} (날짜: ${dates.join(', ')})`;
                }).join('\n');
              }

              // Dynamic attachments (붙임) list
              const uniqueDocs = Array.from(new Set(data.docs || [])) as string[];
              let attachmentText = '';
              if (uniqueDocs.length > 0) {
                const cleanDocs = uniqueDocs.map((docName, idx) => `     ${idx + 1}. ${docName.replace(/\.[^/.]+$/, "")} 1부.`);
                const reportIdx = cleanDocs.length + 1;
                const eschoolIdx = cleanDocs.length + 2;
                
                attachmentText = `붙임 1. ${uniqueDocs[0].replace(/\.[^/.]+$/, "")} 1부.\n` + 
                  cleanDocs.slice(1).map(line => line).join('\n') + (cleanDocs.length > 1 ? '\n' : '') +
                  `     ${reportIdx}. ${draftMonth}월 학생선수활동보고서 1부.\n` +
                  `     ${eschoolIdx}. ${draftMonth}월 e-school 학습확인서 1부.  끝.`;
              } else {
                attachmentText = `붙임 1. ${draftMonth}월 학생선수활동보고서 1부.\n` +
                  `     2. ${draftMonth}월 e-school 학습확인서 1부.  끝.`;
              }

              const maskedName = maskStudentName(studentDetail.name);
              const draftText = `제목  학생 선수 ${draftMonth}월 출석 인정(${studentDetail.gradeClass} ${studentDetail.number}번 ${maskedName})

「${studentDetail.sport} 선수로 등록되어 활동 중인 학생의 ${draftMonth}월 출석을 다음과 같이 인정하고자 합니다.」

1. 대상 : ${studentDetail.gradeClass} ${studentDetail.number}번 ${maskedName}
2. 인정기간 및 내역 :
${formattedAbsences || '   - 결손 내역 없음'}
3. 사유 : ${reasonText}
4. 증빙서류 : 학생선수 활동 보고서, e-school 학습확인서 등

${attachmentText}`;

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
