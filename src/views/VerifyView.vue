<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import VOtpInput from 'vue3-otp-input'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const otpInput = ref<InstanceType<typeof VOtpInput> | null>(null)
const error = ref('')
const isLoading = ref(false)

onMounted(() => {
  if (!authStore.pendingUsername) {
    // No pending user to verify, redirect to register
    router.push('/register')
  }
})

const handleOnComplete = async (value: string) => {
  error.value = ''
  isLoading.value = true
  try {
    await authStore.verifyAccount(value)
    router.push('/login')
  } catch (e: unknown) {
    console.error(e)
    const errorMsg = e instanceof Error ? e.message : String(e)
    error.value = 'Verification failed: ' + errorMsg
    // clear input on error
    otpInput.value?.clearInput()
  } finally {
    isLoading.value = false
  }
}

const handleOnChange = () => {
  // value unused
}
</script>

<template>
  <div class="card shadow-sm">
    <div class="card-body p-4 text-center">
      <h3 class="card-title mb-3">Verify Your Account</h3>
      <p class="text-muted mb-4">
        Enter the 6-digit code sent to your email/device for user
        <strong>{{ authStore.pendingUsername }}</strong>
      </p>

      <div v-if="error" class="alert alert-danger" role="alert">
        {{ error }}
      </div>

      <div class="d-flex justify-content-center mb-4">
        <v-otp-input
          ref="otpInput"
          input-classes="otp-input form-control text-center mx-1"
          separator=""
          :num-inputs="6"
          :should-auto-focus="true"
          :is-input-num="true"
          :conditionalClass="['one', 'two', 'three', 'four', 'five', 'six']"
          @on-change="handleOnChange"
          @on-complete="handleOnComplete"
        />
      </div>

      <div v-if="isLoading" class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Verifying...</span>
      </div>

      <div class="mt-3">
        <small class="text-muted"
          >Didn't receive the code?
          <a href="#" @click.prevent="router.push('/register')">Register again</a>
        </small>
      </div>
    </div>
  </div>
</template>

<style scoped>
.otp-input {
  width: 40px;
  height: 40px;
  padding: 5px;
  margin: 0 5px;
  font-size: 20px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.3);
  text-align: center;
}
/* Focus style handled by bootstrap form-control mostly, but we can enhance */
.otp-input:focus {
  border-color: var(--bs-primary);
  box-shadow: 0 0 0 0.25rem rgba(var(--bs-primary-rgb), 0.25);
  outline: 0;
}
</style>
