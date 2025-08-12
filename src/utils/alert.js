// components/Alert.js
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

export const showSuccessAlert = (title, confirmText = 'OK') => {
  return Swal.fire({
    position: 'top',
    icon: 'success',
    title,
    showConfirmButton: true,
    confirmButtonText: confirmText,
  });
};

export const showWarningAlert = (title, confirmText = 'OK') => {
  return Swal.fire({
    position: 'top',
    icon: 'warning',
    title,
    showConfirmButton: true,
    confirmButtonText: confirmText,
  });
};

export const showErrorAlert = (title, text = '') => {
  return Swal.fire({
    icon: 'error',
    title,
    text,
  });
};
