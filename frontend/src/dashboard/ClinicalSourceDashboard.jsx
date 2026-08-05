// ClinicalSourceDashboard.jsx
import React, { useState, useEffect } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  Box,
  TextField,
  InputAdornment,
  IconButton,
  Chip,
  Avatar,
  Tooltip,
  Zoom,
  Fade,
  CircularProgress,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  Collapse,
  Alert,
  Divider,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  FormControl,
  Select,
  ToggleButtonGroup,
  ToggleButton
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Person as PersonIcon,
  Email as EmailIcon,
  Phone as PhoneIcon,
  CalendarToday as CalendarIcon,
  LocationOn as LocationIcon,
  Business as BusinessIcon,
  Language as LanguageIcon,
  TrendingUp as TrendingUpIcon,
  Groups as GroupsIcon,
  Storage as StorageIcon,
  Webhook as WebhookIcon,
  MoreVert as MoreVertIcon,
  Download as DownloadIcon,
  FilterList as FilterIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
  Speed as SpeedIcon,
  Analytics as AnalyticsIcon,
  Share as ShareIcon,
  Settings as SettingsIcon,
  Help as HelpIcon,
  Clear as ClearIcon,
  Timeline as TimelineIcon,
  DateRange as DateRangeIcon,
  ViewWeek as ViewWeekIcon,
  CalendarMonth as CalendarMonthIcon,
  PieChart as PieChartIcon
} from '@mui/icons-material';
import { styled, alpha } from '@mui/material/styles';
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  Area
} from 'recharts';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { 
  format, 
  subDays, 
  subWeeks, 
  subMonths, 
  subYears, 
  eachDayOfInterval, 
  eachWeekOfInterval,
  eachMonthOfInterval, 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth, 
  startOfYear, 
  endOfYear, 
  isWithinInterval,
  getWeek,
  getYear
} from 'date-fns';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// Professional color palette
const colors = {
  primary: '#2563eb',
  secondary: '#7c3aed',
  success: '#059669',
  warning: '#d97706',
  error: '#dc2626',
  info: '#0891b2',
  gray: '#6b7280',
  lightGray: '#f3f4f6',
  darkGray: '#1f2937',
  chart: {
    line: '#2563eb',
    area: '#3b82f6',
    pie: ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#8b5cf6', '#ec4899']
  }
};

// Styled Components
const DashboardContainer = styled(Box)(({ theme }) => ({
  minHeight: '100vh',
  background: 'linear-gradient(180deg, #f9fafb 0%, #ffffff 100%)',
  padding: theme.spacing(3)
}));

const GlassCard = styled(Card)(({ theme }) => ({
  background: 'rgba(255, 255, 255, 0.9)',
  backdropFilter: 'blur(10px)',
  borderRadius: 24,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.04)',
  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  border: '1px solid rgba(255, 255, 255, 0.8)',
  '&:hover': {
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.08)',
    transform: 'translateY(-2px)'
  }
}));

const StatCard = styled(GlassCard)(({ theme, gradient }) => ({
  padding: theme.spacing(3),
  position: 'relative',
  overflow: 'hidden',
  background: gradient ? `linear-gradient(135deg, ${alpha(colors.primary, 0.02)} 0%, ${alpha(colors.secondary, 0.02)} 100%)` : 'white',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    background: `linear-gradient(90deg, ${colors.primary}, ${colors.secondary})`
  }
}));

const SourceChip = styled(Chip)(({ theme, sourcetype }) => {
  const getSourceColor = () => {
    switch(sourcetype) {
      case 'webpage': return colors.success;
      case 'HOSPEX-2026': return colors.info;
      default: return colors.warning;
    }
  };
  
  const color = getSourceColor();
  return {
    backgroundColor: alpha(color, 0.08),
    color: color,
    fontWeight: 600,
    fontSize: '0.75rem',
    border: `1px solid ${alpha(color, 0.2)}`,
    borderRadius: 8
  };
});

const ChartContainer = styled(Box)({
  padding: 24,
  height: '100%',
  display: 'flex',
  flexDirection: 'column'
});

const ChartHeader = styled(Box)({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 24,
  flexWrap: 'wrap',
  gap: 16
});

const ChartTitle = styled(Typography)({
  fontSize: '1.2rem',
  fontWeight: 600,
  color: colors.darkGray,
  display: 'flex',
  alignItems: 'center',
  gap: 8
});

const MetricValue = styled(Typography)({
  fontSize: '2.5rem',
  fontWeight: 700,
  lineHeight: 1.2,
  color: colors.darkGray,
  marginBottom: 4
});

const MetricLabel = styled(Typography)({
  fontSize: '0.875rem',
  color: colors.gray,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.5px'
});

const TimeRangeToggle = styled(ToggleButtonGroup)({
  backgroundColor: colors.lightGray,
  padding: 4,
  borderRadius: 12,
  '& .MuiToggleButton-root': {
    border: 'none',
    borderRadius: 8,
    padding: '6px 16px',
    textTransform: 'none',
    fontWeight: 600,
    fontSize: '0.875rem',
    color: colors.gray,
    '&.Mui-selected': {
      backgroundColor: 'white',
      color: colors.primary,
      boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
    },
    '&:hover': {
      backgroundColor: 'white'
    }
  }
});

const ChartGrid = styled(Grid)({
  marginBottom: 24
});

function ClinicalSourceDashboard() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [expandedRow, setExpandedRow] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [orderBy, setOrderBy] = useState('created_at');
  const [order, setOrder] = useState('desc');
  const [tabValue, setTabValue] = useState(0);
  const [timeRange, setTimeRange] = useState('month'); // 'week', 'month', 'year'
  
  // Date range filters
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  // Update the fetchUsers function in ClinicalSourceDashboard.jsx
  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null); // Clear any previous errors
      
      console.log('Fetching from:', `${API_BASE_URL}hms/users/hospitals/clinicusersource`);
      
      const response = await fetch(`${API_BASE_URL}hms/users/hospitals/clinicusersource`);
      
      // Log response status
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        // Try to get error details from response
        const errorText = await response.text();
        console.error('Error response:', errorText);
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Received data:', data);
      
      const userData = data.users || data || [];
      setUsers(userData);
      setError(null);
    } catch (err) {
      console.error('Detailed error:', err);
      setError(`Failed to load data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Filter users by date range and other filters
  const filteredUsers = React.useMemo(() => {
    let filtered = [...users];
    
    if (searchTerm) {
      filtered = filtered.filter(user => 
        user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.sys_user_id?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    if (sourceFilter !== 'all') {
      filtered = filtered.filter(user => user.source === sourceFilter);
    }
    
    if (startDate || endDate) {
      filtered = filtered.filter(user => {
        if (!user.created_at) return false;
        const userDate = new Date(user.created_at);
        
        if (startDate && endDate) {
          return userDate >= startDate && userDate <= endDate;
        } else if (startDate) {
          return userDate >= startDate;
        } else if (endDate) {
          return userDate <= endDate;
        }
        return true;
      });
    }
    
    return filtered;
  }, [users, searchTerm, sourceFilter, startDate, endDate]);

  // Generate timeline data based on selected time range
  const timelineData = React.useMemo(() => {
    const now = new Date();
    let intervals = [];
    let dateFormat = '';

    // Determine intervals based on time range
    switch(timeRange) {
      case 'week':
        // Last 7 days
        intervals = eachDayOfInterval({
          start: subDays(now, 6),
          end: now
        });
        dateFormat = 'EEE dd';
        break;
      
      case 'month':
        // Last 4 weeks
        intervals = eachWeekOfInterval({
          start: subWeeks(now, 3),
          end: now
        }, { weekStartsOn: 1 }); // Week starts on Monday
        dateFormat = "'W'w";
        break;
      
      case 'year':
        // Last 12 months
        intervals = eachMonthOfInterval({
          start: subMonths(now, 11),
          end: now
        });
        dateFormat = 'MMM yyyy';
        break;
      
      default:
        intervals = eachDayOfInterval({
          start: subDays(now, 29),
          end: now
        });
        dateFormat = 'dd MMM';
    }

    // Count registrations per interval
    const data = intervals.map(interval => {
      let count = 0;
      
      filteredUsers.forEach(user => {
        if (!user.created_at) return;
        
        const userDate = new Date(user.created_at);
        
        if (timeRange === 'month') {
          // For month view, check if user date falls within the week
          const weekStart = startOfWeek(interval, { weekStartsOn: 1 });
          const weekEnd = endOfWeek(interval, { weekStartsOn: 1 });
          if (userDate >= weekStart && userDate <= weekEnd) {
            count++;
          }
        } else if (timeRange === 'year') {
          // For year view, check if user date falls within the month
          const monthStart = startOfMonth(interval);
          const monthEnd = endOfMonth(interval);
          if (userDate >= monthStart && userDate <= monthEnd) {
            count++;
          }
        } else {
          // For week view, check if user date matches the day
          const dateStr = format(userDate, 'yyyy-MM-dd');
          const intervalStr = format(interval, 'yyyy-MM-dd');
          if (dateStr === intervalStr) {
            count++;
          }
        }
      });

      let displayDate = '';
      if (timeRange === 'month') {
        const weekNum = getWeek(interval, { weekStartsOn: 1 });
        displayDate = `Week ${weekNum}`;
      } else {
        displayDate = format(interval, dateFormat);
      }

      return {
        date: displayDate,
        fullDate: interval,
        count,
        timestamp: interval.getTime()
      };
    });

    // Calculate moving average based on time range
    const dataWithMA = data.map((item, index, array) => {
      let ma = item.count;
      
      if (timeRange === 'year') {
        // 3-month moving average for year view
        if (index >= 2) {
          ma = (array[index].count + array[index-1].count + array[index-2].count) / 3;
        }
      } else if (timeRange === 'month') {
        // 2-week moving average for month view (since we have 4 weeks)
        if (index >= 1) {
          ma = (array[index].count + array[index-1].count) / 2;
        }
      } else {
        // 7-day moving average for week view
        if (index >= 6) {
          ma = array.slice(index-6, index+1).reduce((sum, i) => sum + i.count, 0) / 7;
        }
      }
      
      return {
        ...item,
        movingAverage: Math.round(ma * 10) / 10
      };
    });

    return dataWithMA;
  }, [filteredUsers, timeRange]);

  // Source distribution data for pie chart
  const sourceDistribution = React.useMemo(() => {
    const distribution = {};
    
    filteredUsers.forEach(user => {
      const source = user.source || 'Unknown';
      distribution[source] = (distribution[source] || 0) + 1;
    });

    return Object.entries(distribution)
      .map(([name, value]) => ({
        name,
        value,
        percentage: ((value / filteredUsers.length) * 100).toFixed(1)
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredUsers]);

  // Summary statistics
  const summary = React.useMemo(() => {
    const total = filteredUsers.length;
    const uniqueSources = sourceDistribution.length;
    
    // Calculate growth compared to previous period
    const now = new Date();
    let previousPeriodUsers = 0;
    
    if (timeRange === 'week') {
      const previousWeek = filteredUsers.filter(user => {
        if (!user.created_at) return false;
        const userDate = new Date(user.created_at);
        return userDate >= subWeeks(now, 2) && userDate < subWeeks(now, 1);
      }).length;
      previousPeriodUsers = previousWeek;
    } else if (timeRange === 'month') {
      const previousMonth = filteredUsers.filter(user => {
        if (!user.created_at) return false;
        const userDate = new Date(user.created_at);
        return userDate >= subMonths(now, 2) && userDate < subMonths(now, 1);
      }).length;
      previousPeriodUsers = previousMonth;
    } else {
      const previousYear = filteredUsers.filter(user => {
        if (!user.created_at) return false;
        const userDate = new Date(user.created_at);
        return userDate >= subYears(now, 2) && userDate < subYears(now, 1);
      }).length;
      previousPeriodUsers = previousYear;
    }
    
    const growth = previousPeriodUsers > 0 
      ? ((total - previousPeriodUsers) / previousPeriodUsers * 100).toFixed(1)
      : '0';
    
    // Calculate average based on time range
    let avg = 0;
    let avgLabel = '';
    if (timeRange === 'week') {
      avg = (total / 7).toFixed(1);
      avgLabel = 'day';
    } else if (timeRange === 'month') {
      avg = (total / 4).toFixed(1);
      avgLabel = 'week';
    } else {
      avg = (total / 12).toFixed(1);
      avgLabel = 'month';
    }
    
    return {
      total,
      uniqueSources,
      growth,
      avg,
      period: avgLabel
    };
  }, [filteredUsers, timeRange, sourceDistribution]);

  // Sorting
  const sortedUsers = React.useMemo(() => {
    return [...filteredUsers].sort((a, b) => {
      const aValue = a[orderBy] || '';
      const bValue = b[orderBy] || '';
      
      if (order === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  }, [filteredUsers, orderBy, order]);

  const paginatedUsers = sortedUsers.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const exportToExcel = () => {
    const exportData = filteredUsers.map(user => ({
      'User ID': user.sys_user_id || 'N/A',
      'Name': user.name || 'N/A',
      'Email': user.email || 'N/A',
      'Phone': user.phone_number || 'N/A',
      'Source': user.source || 'Unknown',
      'Country': user.country_code || 'N/A',
      'Address': user.address || 'N/A',
      'Headquarters': user.headquarters || 'N/A',
      'User Type': user.hospital_user_type || 'N/A',
      'Registration Date': user.created_at ? new Date(user.created_at).toLocaleString() : 'N/A'
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const data = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    let filename = `user_registrations_${timeRange}_${new Date().toISOString().split('T')[0]}.xlsx`;
    saveAs(data, filename);
    handleMenuClose();
  };

  const handleRequestSort = (property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
    setExpandedRow(null);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleRowClick = (userId) => {
    setExpandedRow(expandedRow === userId ? null : userId);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getUniqueSources = () => {
    const sources = new Set(users.map(u => u.source).filter(Boolean));
    return ['all', ...sources];
  };

  const handleMenuClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const clearDateFilters = () => {
    setStartDate(null);
    setEndDate(null);
  };

  const getStatus = (user) => {
    if (user.email && user.phone_number) return 'active';
    if (user.email || user.phone_number) return 'pending';
    return 'inactive';
  };

  const handleTimeRangeChange = (event, newRange) => {
    if (newRange !== null) {
      setTimeRange(newRange);
    }
  };

  const getTimeRangeLabel = () => {
    switch(timeRange) {
      case 'week': return 'Daily';
      case 'month': return 'Weekly';
      case 'year': return 'Monthly';
      default: return '';
    }
  };

  if (loading) {
    return (
      <DashboardContainer>
        <Container maxWidth="xl">
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column',
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '80vh',
            gap: 3
          }}>
            <CircularProgress size={60} thickness={4} sx={{ color: colors.primary }} />
            <Typography variant="body1" sx={{ color: colors.gray }}>
              Loading dashboard data...
            </Typography>
          </Box>
        </Container>
      </DashboardContainer>
    );
  }

  if (error) {
    return (
      <DashboardContainer>
        <Container maxWidth="xl">
          <Alert 
            severity="error" 
            action={
              <Button 
                color="inherit" 
                size="small" 
                onClick={fetchUsers}
                sx={{ borderRadius: 2 }}
              >
                Retry
              </Button>
            }
            sx={{ 
              borderRadius: 3,
              boxShadow: '0 4px 12px rgba(220, 38, 38, 0.1)'
            }}
          >
            {error}
          </Alert>
        </Container>
      </DashboardContainer>
    );
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <DashboardContainer>
        <Container maxWidth="xl">
          {/* Header */}
          <Fade in timeout={800}>
            <Box sx={{ mb: 4 }}>
              <Grid container justifyContent="space-between" alignItems="center">
                <Grid item>
                  <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5, color: colors.darkGray }}>
                    User Registration Dashboard
                  </Typography>
                  <Typography variant="body1" sx={{ color: colors.gray }}>
                    Track and analyze user registrations across different sources
                  </Typography>
                </Grid>
                <Grid item>
                  <Stack direction="row" spacing={2}>
                    <Button
                      variant="outlined"
                      startIcon={<DownloadIcon />}
                      onClick={exportToExcel}
                      sx={{
                        borderRadius: 3,
                        borderColor: colors.gray,
                        color: colors.gray,
                        '&:hover': {
                          borderColor: colors.primary,
                          color: colors.primary,
                          backgroundColor: alpha(colors.primary, 0.02)
                        }
                      }}
                    >
                      Export Excel
                    </Button>
                    <Button
                      variant="contained"
                      startIcon={<ShareIcon />}
                      sx={{
                        borderRadius: 3,
                        background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
                        boxShadow: `0 8px 16px ${alpha(colors.primary, 0.2)}`,
                        '&:hover': {
                          boxShadow: `0 12px 20px ${alpha(colors.primary, 0.3)}`,
                        }
                      }}
                    >
                      Share Report
                    </Button>
                    <IconButton
                      onClick={handleMenuClick}
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 2,
                        backgroundColor: colors.lightGray,
                        '&:hover': {
                          backgroundColor: alpha(colors.primary, 0.1)
                        }
                      }}
                    >
                      <MoreVertIcon sx={{ color: colors.gray }} />
                    </IconButton>
                  </Stack>
                </Grid>
              </Grid>
            </Box>
          </Fade>

          {/* Stats Cards */}
          <Grid container spacing={3} sx={{ mb: 4 }}>
            <Grid item xs={12} md={4}>
              <Zoom in style={{ transitionDelay: '100ms' }}>
                <StatCard gradient>
                  <Box sx={{ position: 'relative', zIndex: 1 }}>
                    <MetricLabel>Total Users</MetricLabel>
                    <MetricValue>{summary.total.toLocaleString()}</MetricValue>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                      <TrendingUpIcon sx={{ fontSize: 16, color: parseFloat(summary.growth) >= 0 ? colors.success : colors.error }} />
                      <Typography variant="body2" sx={{ color: parseFloat(summary.growth) >= 0 ? colors.success : colors.error, fontWeight: 600 }}>
                        {parseFloat(summary.growth) >= 0 ? '+' : ''}{summary.growth}%
                      </Typography>
                      <Typography variant="caption" sx={{ color: colors.gray }}>
                        vs previous {timeRange}
                      </Typography>
                    </Box>
                  </Box>
                  <GroupsIcon sx={{ 
                    position: 'absolute',
                    right: 20,
                    top: 20,
                    fontSize: 48,
                    color: alpha(colors.primary, 0.1)
                  }} />
                </StatCard>
              </Zoom>
            </Grid>

            <Grid item xs={12} md={4}>
              <Zoom in style={{ transitionDelay: '200ms' }}>
                <StatCard gradient>
                  <Box sx={{ position: 'relative', zIndex: 1 }}>
                    <MetricLabel>Active Sources</MetricLabel>
                    <MetricValue>{summary.uniqueSources}</MetricValue>
                    <Typography variant="caption" sx={{ color: colors.gray, mt: 1, display: 'block' }}>
                      {getUniqueSources().length - 1} total channels
                    </Typography>
                  </Box>
                  <WebhookIcon sx={{ 
                    position: 'absolute',
                    right: 20,
                    top: 20,
                    fontSize: 48,
                    color: alpha(colors.secondary, 0.1)
                  }} />
                </StatCard>
              </Zoom>
            </Grid>

            <Grid item xs={12} md={4}>
              <Zoom in style={{ transitionDelay: '300ms' }}>
                <StatCard gradient>
                  <Box sx={{ position: 'relative', zIndex: 1 }}>
                    <MetricLabel>Avg. per {summary.period}</MetricLabel>
                    <MetricValue>{summary.avg}</MetricValue>
                    <Typography variant="caption" sx={{ color: colors.gray, mt: 1, display: 'block' }}>
                      Based on selected period
                    </Typography>
                  </Box>
                  <TimelineIcon sx={{ 
                    position: 'absolute',
                    right: 20,
                    top: 20,
                    fontSize: 48,
                    color: alpha(colors.success, 0.1)
                  }} />
                </StatCard>
              </Zoom>
            </Grid>
          </Grid>

          {/* Charts Section - Two Equal Sized Charts */}
          <ChartGrid container spacing={3}>
            {/* Line Graph - Full Width */}
            <Grid item xs={12}>
              <GlassCard>
                <ChartContainer>
                  <ChartHeader>
                    <ChartTitle>
                      <TimelineIcon sx={{ color: colors.primary }} />
                      Registration Trends - {getTimeRangeLabel()} View
                    </ChartTitle>
                    
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <TimeRangeToggle
                        value={timeRange}
                        exclusive
                        onChange={handleTimeRangeChange}
                        aria-label="time range"
                      >
                        <ToggleButton value="week" aria-label="week view">
                          Week
                        </ToggleButton>
                        <ToggleButton value="month" aria-label="month view">
                          Month
                        </ToggleButton>
                        <ToggleButton value="year" aria-label="year view">
                          Year
                        </ToggleButton>
                      </TimeRangeToggle>
                      
                      <Chip 
                        label={`${filteredUsers.length} registrations`}
                        size="small"
                        sx={{ borderRadius: 2, backgroundColor: colors.lightGray }}
                      />
                    </Box>
                  </ChartHeader>
                  
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={timelineData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                      <defs>
                        <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={colors.primary} stopOpacity={0.2}/>
                          <stop offset="95%" stopColor={colors.primary} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 12, fill: colors.gray }}
                        tickLine={false}
                        axisLine={false}
                        interval={timeRange === 'year' ? 1 : 0}
                      />
                      <YAxis 
                        tick={{ fontSize: 12, fill: colors.gray }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'white',
                          borderRadius: 16,
                          border: '1px solid #f0f0f0',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                          padding: '12px 16px'
                        }} 
                        formatter={(value, name) => {
                          if (name === 'Daily Registrations') return [value, 'Registrations'];
                          if (name === 'Moving Average') {
                            let avgLabel = '';
                            if (timeRange === 'year') avgLabel = '3-Month';
                            else if (timeRange === 'month') avgLabel = '2-Week';
                            else avgLabel = '7-Day';
                            return [value, `${avgLabel} Avg`];
                          }
                          return [value, name];
                        }}
                      />
                      <Legend 
                        verticalAlign="top" 
                        height={36}
                        iconType="circle"
                        formatter={(value) => {
                          if (value === 'Daily Registrations') return 'Actual Registrations';
                          if (value === 'Moving Average') {
                            if (timeRange === 'year') return '3-Month Moving Average';
                            if (timeRange === 'month') return '2-Week Moving Average';
                            return '7-Day Moving Average';
                          }
                          return value;
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="none"
                        fill="url(#colorGradient)"
                        name="Daily Registrations"
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        stroke={colors.primary}
                        strokeWidth={3}
                        dot={{ fill: colors.primary, stroke: 'white', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 8, fill: colors.primary, stroke: 'white', strokeWidth: 2 }}
                        name="Daily Registrations"
                      />
                      <Line
                        type="monotone"
                        dataKey="movingAverage"
                        stroke={colors.secondary}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                        name="Moving Average"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </GlassCard>
            </Grid>

            {/* Pie Chart - Full Width with Larger Size */}
            <Grid item xs={12}>
              <GlassCard>
                <ChartContainer>
                  <ChartHeader>
                    <ChartTitle>
                      <PieChartIcon sx={{ color: colors.secondary }} />
                      Source Distribution
                    </ChartTitle>
                    <Chip 
                      label={`${sourceDistribution.length} sources`}
                      size="small"
                      sx={{ borderRadius: 2, backgroundColor: colors.lightGray }}
                    />
                  </ChartHeader>
                  
                  <ResponsiveContainer width="100%" height={350}>
                    <PieChart>
                      <Pie
                        data={sourceDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={100}
                        outerRadius={130} 
                        paddingAngle={2}
                        dataKey="value"
                        labelLine={false}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {sourceDistribution.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={colors.chart.pie[index % colors.chart.pie.length]}
                            stroke="white"
                            strokeWidth={2}
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'white',
                          borderRadius: 16,
                          border: '1px solid #f0f0f0',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                          padding: '12px 16px'
                        }} 
                        formatter={(value, name, props) => [
                          `${value} users (${props.payload.percentage}%)`, 
                          props.payload.name
                        ]}
                      />
                      <Legend 
                        verticalAlign="bottom" 
                        height={50}
                        iconType="circle"
                        layout="horizontal"
                        wrapperStyle={{ paddingTop: 20 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  
                  {/* Source Legend Summary - FIXED: Properly proportioned with width 100 */}
                  <Box sx={{ mt: 4, display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center' }}>
                    {sourceDistribution.slice(0, 5).map((source, index) => (
                      <Box 
                        key={source.name}
                        sx={{ 
                          display: 'flex', 
                          alignItems: 'center',
                          gap: 1,
                          px: 2,
                          py: 1,
                          backgroundColor: colors.lightGray,
                          borderRadius: 20
                        }}
                      >
                        {/* Fixed: Using a mini progress bar style that works with width 100 */}
                        <Box sx={{ 
                          width: 100,
                          height: 8,
                          borderRadius: 4,
                          background: `linear-gradient(90deg, ${colors.chart.pie[index]} 0%, ${colors.chart.pie[index]} ${source.percentage}%, ${colors.lightGray} ${source.percentage}%, ${colors.lightGray} 100%)`,
                          border: `1px solid ${alpha(colors.chart.pie[index], 0.2)}`
                        }} />
                        <Typography variant="caption" sx={{ fontWeight: 500 }}>
                          {source.name}: {source.percentage}%
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </ChartContainer>
              </GlassCard>
            </Grid>
          </ChartGrid>

          {/* Filter Section */}
          <GlassCard sx={{ mb: 4 }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: colors.gray, fontWeight: 600 }}>
                <FilterIcon sx={{ fontSize: 18, mr: 1, verticalAlign: 'middle' }} />
                Filters
              </Typography>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={3}>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Search users..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        borderRadius: 3,
                        backgroundColor: colors.lightGray
                      }
                    }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon sx={{ color: colors.gray, fontSize: 20 }} />
                        </InputAdornment>
                      )
                    }}
                  />
                </Grid>
                <Grid item xs={12} md={2}>
                  <FormControl fullWidth size="small">
                    <Select
                      value={sourceFilter}
                      onChange={(e) => setSourceFilter(e.target.value)}
                      displayEmpty
                      sx={{ borderRadius: 3, backgroundColor: colors.lightGray }}
                    >
                      <MenuItem value="all">All Sources</MenuItem>
                      {getUniqueSources().filter(s => s !== 'all').map(source => (
                        <MenuItem key={source} value={source}>{source}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={3}>
                  <DatePicker
                    label="Start Date"
                    value={startDate}
                    onChange={setStartDate}
                    slotProps={{
                      textField: {
                        size: 'small',
                        fullWidth: true,
                        sx: { 
                          '& .MuiOutlinedInput-root': { 
                            borderRadius: 3,
                            backgroundColor: colors.lightGray
                          } 
                        }
                      }
                    }}
                  />
                </Grid>
                <Grid item xs={12} md={3}>
                  <DatePicker
                    label="End Date"
                    value={endDate}
                    onChange={setEndDate}
                    slotProps={{
                      textField: {
                        size: 'small',
                        fullWidth: true,
                        sx: { 
                          '& .MuiOutlinedInput-root': { 
                            borderRadius: 3,
                            backgroundColor: colors.lightGray
                          } 
                        }
                      }
                    }}
                  />
                </Grid>
                <Grid item xs={12} md={1}>
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={clearDateFilters}
                    startIcon={<ClearIcon />}
                    sx={{ borderRadius: 3 }}
                  >
                    Clear
                  </Button>
                </Grid>
              </Grid>
              
              {/* Active Filters Display */}
              {(startDate || endDate || searchTerm || sourceFilter !== 'all') && (
                <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="caption" sx={{ color: colors.gray, mr: 1 }}>
                    Active Filters:
                  </Typography>
                  {searchTerm && (
                    <Chip
                      label={`Search: ${searchTerm}`}
                      size="small"
                      onDelete={() => setSearchTerm('')}
                      sx={{ borderRadius: 2 }}
                    />
                  )}
                  {sourceFilter !== 'all' && (
                    <Chip
                      label={`Source: ${sourceFilter}`}
                      size="small"
                      onDelete={() => setSourceFilter('all')}
                      sx={{ borderRadius: 2 }}
                    />
                  )}
                  {startDate && (
                    <Chip
                      label={`From: ${format(startDate, 'dd MMM yyyy')}`}
                      size="small"
                      onDelete={() => setStartDate(null)}
                      sx={{ borderRadius: 2 }}
                    />
                  )}
                  {endDate && (
                    <Chip
                      label={`To: ${format(endDate, 'dd MMM yyyy')}`}
                      size="small"
                      onDelete={() => setEndDate(null)}
                      sx={{ borderRadius: 2 }}
                    />
                  )}
                </Box>
              )}
            </CardContent>
          </GlassCard>

          {/* Tabs for different views */}
          <Box sx={{ mb: 3 }}>
            <Tabs 
              value={tabValue} 
              onChange={(e, v) => setTabValue(v)}
              sx={{
                '& .MuiTab-root': {
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: '0.95rem',
                  minHeight: 48
                }
              }}
            >
              <Tab label="All Users" />
              <Tab label="Recent Activity" />
              <Tab label="Top Sources" />
            </Tabs>
          </Box>

          {/* Users Table */}
          <TabPanel value={tabValue} index={0}>
            <GlassCard>
              <TableContainer>
                <Table>
                  <TableHead>
                    <TableRow sx={{ backgroundColor: '#fafafa' }}>
                      <TableCell padding="checkbox" width={40} />
                      <TableCell>
                        <TableSortLabel
                          active={orderBy === 'name'}
                          direction={orderBy === 'name' ? order : 'asc'}
                          onClick={() => handleRequestSort('name')}
                          sx={{ fontWeight: 600, color: colors.gray }}
                        >
                          User
                        </TableSortLabel>
                      </TableCell>
                      <TableCell width={140}>Status</TableCell>
                      <TableCell width={120}>Source</TableCell>
                      <TableCell>Contact</TableCell>
                      <TableCell width={100}>Location</TableCell>
                      <TableCell width={140}>
                        <TableSortLabel
                          active={orderBy === 'created_at'}
                          direction={orderBy === 'created_at' ? order : 'asc'}
                          onClick={() => handleRequestSort('created_at')}
                          sx={{ fontWeight: 600, color: colors.gray }}
                        >
                          Registered
                        </TableSortLabel>
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paginatedUsers.map((user) => {
                      const status = getStatus(user);
                      return (
                        <React.Fragment key={user._id}>
                          <TableRow 
                            onClick={() => handleRowClick(user._id)}
                            sx={{ 
                              cursor: 'pointer',
                              '&:hover': { backgroundColor: alpha(colors.primary, 0.02) },
                              backgroundColor: expandedRow === user._id ? alpha(colors.primary, 0.02) : 'transparent'
                            }}
                          >
                            <TableCell padding="checkbox">
                              <IconButton size="small" sx={{ color: colors.gray }}>
                                {expandedRow === user._id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                              </IconButton>
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Avatar sx={{ 
                                  width: 40, 
                                  height: 40, 
                                  bgcolor: alpha(colors.primary, 0.08), 
                                  color: colors.primary,
                                  fontSize: '1rem',
                                  fontWeight: 600
                                }}>
                                  {user.name?.charAt(0) || '?'}
                                </Avatar>
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {user.name || 'N/A'}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: colors.gray }}>
                                    ID: {user.sys_user_id?.slice(-8) || 'N/A'}
                                  </Typography>
                                </Box>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={status}>
                                {status === 'active' && <CheckCircleIcon sx={{ fontSize: 14 }} />}
                                {status === 'pending' && <WarningIcon sx={{ fontSize: 14 }} />}
                                {status === 'inactive' && <ErrorIcon sx={{ fontSize: 14 }} />}
                                {status.charAt(0).toUpperCase() + status.slice(1)}
                              </StatusBadge>
                            </TableCell>
                            <TableCell>
                              <SourceChip 
                                label={user.source || 'Unknown'}
                                size="small"
                                sourcetype={user.source}
                              />
                            </TableCell>
                            <TableCell>
                              <Box>
                                <Typography variant="caption" display="block" sx={{ fontWeight: 500 }}>
                                  {user.email || 'N/A'}
                                </Typography>
                                <Typography variant="caption" sx={{ color: colors.gray }}>
                                  {user.phone_number || 'N/A'}
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={user.country_code || 'N/A'}
                                size="small"
                                variant="outlined"
                                sx={{ borderRadius: 1.5, borderColor: colors.lightGray }}
                              />
                            </TableCell>
                            <TableCell>
                              <Tooltip title={formatDate(user.created_at)} arrow>
                                <Typography variant="caption" sx={{ color: colors.gray }}>
                                  {new Date(user.created_at).toLocaleDateString()}
                                </Typography>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                          
                          {/* Expanded Details Panel */}
                          {expandedRow === user._id && (
                            <TableRow>
                              <TableCell colSpan={7} sx={{ p: 0, borderBottom: 'none' }}>
                                <Collapse in={expandedRow === user._id}>
                                  <Box sx={{ p: 3, backgroundColor: '#fafafa' }}>
                                    <Grid container spacing={3}>
                                      <Grid item xs={12} md={4}>
                                        <Typography variant="subtitle2" sx={{ color: colors.primary, mb: 2 }}>
                                          Personal Information
                                        </Typography>
                                        <Stack spacing={1}>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <PersonIcon sx={{ fontSize: 18, color: colors.gray }} />
                                            <Typography variant="body2">
                                              <strong>Username:</strong> {user.username || 'N/A'}
                                            </Typography>
                                          </Box>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <EmailIcon sx={{ fontSize: 18, color: colors.gray }} />
                                            <Typography variant="body2">
                                              <strong>Email:</strong> {user.email || 'N/A'}
                                            </Typography>
                                          </Box>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <PhoneIcon sx={{ fontSize: 18, color: colors.gray }} />
                                            <Typography variant="body2">
                                              <strong>Phone:</strong> {user.phone_number || 'N/A'}
                                            </Typography>
                                          </Box>
                                        </Stack>
                                      </Grid>
                                      <Grid item xs={12} md={4}>
                                        <Typography variant="subtitle2" sx={{ color: colors.primary, mb: 2 }}>
                                          Location Details
                                        </Typography>
                                        <Stack spacing={1}>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <LocationIcon sx={{ fontSize: 18, color: colors.gray }} />
                                            <Typography variant="body2">
                                              <strong>Address:</strong> {user.address || 'N/A'}
                                            </Typography>
                                          </Box>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <BusinessIcon sx={{ fontSize: 18, color: colors.gray }} />
                                            <Typography variant="body2">
                                              <strong>Headquarters:</strong> {user.headquarters || 'N/A'}
                                            </Typography>
                                          </Box>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <LanguageIcon sx={{ fontSize: 18, color: colors.gray }} />
                                            <Typography variant="body2">
                                              <strong>Country:</strong> {user.country_code || 'N/A'}
                                            </Typography>
                                          </Box>
                                        </Stack>
                                      </Grid>
                                      <Grid item xs={12} md={4}>
                                        <Typography variant="subtitle2" sx={{ color: colors.primary, mb: 2 }}>
                                          System Information
                                        </Typography>
                                        <Stack spacing={1}>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <StorageIcon sx={{ fontSize: 18, color: colors.gray }} />
                                            <Typography variant="body2">
                                              <strong>Hospital ID:</strong> {user.sys_user_id || 'N/A'}
                                            </Typography>
                                          </Box>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <BusinessIcon sx={{ fontSize: 18, color: colors.gray }} />
                                            <Typography variant="body2">
                                              <strong>Original ID:</strong> {user.hospital_id || 'N/A'}
                                            </Typography>
                                          </Box>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <CalendarIcon sx={{ fontSize: 18, color: colors.gray }} />
                                            <Typography variant="body2">
                                              <strong>Type:</strong> {user.hospital_user_type || 'N/A'}
                                            </Typography>
                                          </Box>
                                        </Stack>
                                      </Grid>
                                    </Grid>
                                  </Box>
                                </Collapse>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              
              {/* Pagination */}
              <Box sx={{ p: 3, borderTop: '1px solid #f0f0f0' }}>
                <Grid container justifyContent="space-between" alignItems="center">
                  <Grid item>
                    <Typography variant="caption" sx={{ color: colors.gray }}>
                      Showing {page * rowsPerPage + 1} to {Math.min((page + 1) * rowsPerPage, filteredUsers.length)} of {filteredUsers.length} entries
                    </Typography>
                  </Grid>
                  <Grid item>
                    <TablePagination
                      component="div"
                      count={filteredUsers.length}
                      page={page}
                      onPageChange={handleChangePage}
                      rowsPerPage={rowsPerPage}
                      onRowsPerPageChange={handleChangeRowsPerPage}
                      rowsPerPageOptions={[10, 25, 50, 100]}
                      sx={{
                        '.MuiTablePagination-select': {
                          borderRadius: 2
                        }
                      }}
                    />
                  </Grid>
                </Grid>
              </Box>
            </GlassCard>
          </TabPanel>

          <TabPanel value={tabValue} index={1}>
            <GlassCard>
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ mb: 3 }}>Recent Activity</Typography>
                <Stack spacing={2}>
                  {filteredUsers.slice(0, 10).map((user, index) => (
                    <Box 
                      key={user._id}
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 2,
                        p: 2,
                        borderRadius: 2,
                        backgroundColor: index % 2 === 0 ? colors.lightGray : 'transparent'
                      }}
                    >
                      <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(colors.primary, 0.1) }}>
                        <PersonIcon sx={{ fontSize: 16, color: colors.primary }} />
                      </Avatar>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          New user registered: {user.name || 'Unknown'}
                        </Typography>
                        <Typography variant="caption" sx={{ color: colors.gray }}>
                          Source: {user.source || 'Unknown'} • {formatDate(user.created_at)}
                        </Typography>
                      </Box>
                      <Chip 
                        label="New" 
                        size="small" 
                        sx={{ 
                          backgroundColor: alpha(colors.success, 0.1),
                          color: colors.success,
                          fontWeight: 600
                        }} 
                      />
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </GlassCard>
          </TabPanel>

          <TabPanel value={tabValue} index={2}>
            <Grid container spacing={3}>
              {sourceDistribution.map((source, index) => (
                <Grid item xs={12} md={4} key={source.name}>
                  <GlassCard>
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                        <Avatar sx={{ bgcolor: alpha(colors.chart.pie[index], 0.1) }}>
                          <WebhookIcon sx={{ color: colors.chart.pie[index] }} />
                        </Avatar>
                        <Typography variant="h6">{source.name}</Typography>
                      </Box>
                      <Typography variant="h3" sx={{ mb: 1 }}>{source.value}</Typography>
                      <Typography variant="body2" sx={{ color: colors.gray }}>
                        {source.percentage}% of total users
                      </Typography>
                    </CardContent>
                  </GlassCard>
                </Grid>
              ))}
            </Grid>
          </TabPanel>

          {/* Menu */}
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleMenuClose}
            PaperProps={{
              sx: {
                borderRadius: 3,
                boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                mt: 1
              }
            }}
          >
            <MenuItem onClick={handleMenuClose}>
              <ListItemIcon>
                <SettingsIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Dashboard Settings</ListItemText>
            </MenuItem>
            <MenuItem onClick={handleMenuClose}>
              <ListItemIcon>
                <HelpIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Help & Support</ListItemText>
            </MenuItem>
            <Divider />
            <MenuItem onClick={exportToExcel}>
              <ListItemIcon>
                <DownloadIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Export Data</ListItemText>
            </MenuItem>
          </Menu>
        </Container>
      </DashboardContainer>
    </LocalizationProvider>
  );
}

// Helper component for TabPanel
function TabPanel({ children, value, index }) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && children}
    </div>
  );
}

// StatusBadge component
const StatusBadge = styled(Box)(({ theme, status }) => {
  const colors = {
    active: { bg: alpha(theme.palette.success.main, 0.1), color: theme.palette.success.main },
    pending: { bg: alpha(theme.palette.warning.main, 0.1), color: theme.palette.warning.main },
    inactive: { bg: alpha(theme.palette.error.main, 0.1), color: theme.palette.error.main }
  };
  
  const colorSet = colors[status] || colors.inactive;
  
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 12px',
    borderRadius: 20,
    backgroundColor: colorSet.bg,
    color: colorSet.color,
    fontSize: '0.75rem',
    fontWeight: 600,
    gap: 4
  };
});

export default ClinicalSourceDashboard;