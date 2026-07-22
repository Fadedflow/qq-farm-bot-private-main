<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { computed, reactive, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import { useWxLoginStore } from '@/stores/wx-login'

const props = defineProps<{
  show: boolean
  editData?: any
}>()

const emit = defineEmits(['close', 'saved'])

const CODE_QUERY_RE = /[?&]code=([^&]+)/i
const QR_AUTO_REFRESH_MS = 110_000

const wxLoginStore = useWxLoginStore()

const proxyRunning = ref(false)
const proxyPort = ref(0)
const proxyAddress = ref('')
const proxyPublicAddress = ref('')
const proxyCodes = ref<string[]>([])
const proxyLoading = ref(false)
const proxyPollTimer = ref<ReturnType<typeof setInterval> | null>(null)
let proxyCodeAdded: string | null = null

const activeTab = ref<'wx' | 'manual' | 'proxy'>('manual')
const loading = ref(false)
const wxChecking = ref(false)
const errorMessage = ref('')
const wxAccountName = ref('')

const form = reactive({
  name: '',
  code: '',
  platform: 'qq' as 'qq' | 'wx',
})

const { pause: stopWxCheck, resume: startWxCheck } = useIntervalFn(async () => {
  if (activeTab.value !== 'wx' || wxLoginStore.isLoading || wxChecking.value)
    return
  if (shouldRefreshWxQr()) {
    await loadWxQRCode()
    return
  }
  if (wxLoginStore.status !== 'qr_ready' && wxLoginStore.status !== 'confirming')
    return

  wxChecking.value = true
  try {
    const result = await wxLoginStore.checkLogin()
    if (result.success && result.wxid) {
      stopWxCheck()
      const codeResult = await wxLoginStore.getFarmCode(result.wxid)
      if (codeResult.success && codeResult.code) {
        const name = wxAccountName.value.trim() || result.nickname || `微信账号${Date.now()}`
        if (wxLoginStore.config.autoAddAccount) {
          await addAccount({
            id: props.editData?.id,
            name: props.editData ? (props.editData.name || name) : name,
            code: codeResult.code,
            platform: 'wx',
            loginType: 'wx_qr',
            wxid: result.wxid,
            avatar: result.avatar,
          })
        }
        else {
          form.code = codeResult.code
          form.platform = 'wx'
          activeTab.value = 'manual'
        }
      }
    }
  }
  finally {
    wxChecking.value = false
  }
}, 2000, { immediate: false })

function shouldRefreshWxQr() {
  return !!wxLoginStore.qrCreatedAt
    && (wxLoginStore.status === 'qr_ready' || wxLoginStore.status === 'confirming')
    && Date.now() - wxLoginStore.qrCreatedAt > QR_AUTO_REFRESH_MS
}

async function loadWxQRCode() {
  if (activeTab.value !== 'wx')
    return
  stopWxCheck()
  wxLoginStore.resetState()
  const success = await wxLoginStore.getQRCode()
  if (success)
    startWxCheck()
}

async function addAccount(data: any) {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await api.post('/api/accounts', data)
    if (res.data.ok) {
      emit('saved')
      close()
    }
    else {
      errorMessage.value = `保存失败: ${res.data.error}`
    }
  }
  catch (e: any) {
    errorMessage.value = `保存失败: ${e.response?.data?.error || e.message}`
  }
  finally {
    loading.value = false
  }
}

async function submitManual() {
  errorMessage.value = ''
  if (!form.code) {
    errorMessage.value = '请输入 Code'
    return
  }

  let code = form.code.trim()
  const match = code.match(CODE_QUERY_RE)
  if (match && match[1]) {
    code = decodeURIComponent(match[1])
    form.code = code
  }

  let payload: any = {}
  if (props.editData) {
    const onlyNameChanged = form.name !== props.editData.name
      && form.code === (props.editData.code || '')
      && form.platform === (props.editData.platform || 'qq')

    if (onlyNameChanged) {
      payload = { id: props.editData.id, name: form.name }
    }
    else {
      payload = {
        id: props.editData.id,
        name: form.name,
        code,
        platform: form.platform,
        loginType: 'manual',
      }
    }
  }
  else {
    payload = {
      name: form.name,
      code,
      platform: form.platform,
      loginType: 'manual',
    }
  }

  await addAccount(payload)
}

async function fetchProxyStatus() {
  try {
    const res = await api.get('/api/admin/qq-proxy/status')
    if (res.data.ok && res.data.data) {
      proxyRunning.value = res.data.data.running
      proxyPort.value = res.data.data.port
      proxyAddress.value = res.data.data.address
      proxyPublicAddress.value = res.data.data.publicAddress || ''
    }
  } catch {}
}

async function startQQProxy() {
  proxyLoading.value = true
  try {
    const res = await api.post('/api/admin/qq-proxy/start')
    if (res.data.ok) {
      await fetchProxyStatus()
      startProxyPolling()
    }
  } catch {}
  finally { proxyLoading.value = false }
}

async function stopQQProxy() {
  try {
    await api.post('/api/admin/qq-proxy/stop')
    await fetchProxyStatus()
    stopProxyPolling()
  } catch {}
}

function startProxyPolling() {
  stopProxyPolling()
  proxyPollTimer.value = setInterval(async () => {
    try {
      const res = await api.get('/api/admin/qq-proxy/codes')
      if (res.data.ok && res.data.data) {
        const codes: string[] = res.data.data.codes
        for (const code of codes) {
          if (!proxyCodes.value.includes(code) && code !== proxyCodeAdded) {
            proxyCodes.value.push(code)
            proxyCodeAdded = code
            const name = `QQ账号${Date.now()}`
            try {
              await addAccount({
                name,
                code,
                platform: 'qq' as const,
                loginType: 'proxy_capture',
              })
              proxyCodeAdded = code
            } catch {}
          }
        }
      }
    } catch {}
  }, 2000)
}

function stopProxyPolling() {
  if (proxyPollTimer.value) {
    clearInterval(proxyPollTimer.value)
    proxyPollTimer.value = null
  }
}

const wxQrImageSrc = computed(() => {
  if (!wxLoginStore.qrCode)
    return ''
  if (wxLoginStore.qrCode.startsWith('data:'))
    return wxLoginStore.qrCode
  if (wxLoginStore.qrCode.startsWith('http'))
    return wxLoginStore.qrCode
  return `data:image/png;base64,${wxLoginStore.qrCode}`
})

function close() {
  stopWxCheck()
  wxLoginStore.resetState()
  stopProxyPolling()
  emit('close')
}

watch(() => props.show, (newVal) => {
  if (newVal) {
    errorMessage.value = ''
    if (props.editData) {
      activeTab.value = 'manual'
      form.name = props.editData.name || ''
      form.code = props.editData.code || ''
      form.platform = props.editData.platform || 'qq'
      wxAccountName.value = props.editData.name || ''
    }
    else {
      activeTab.value = 'manual'
      form.name = ''
      form.code = ''
      form.platform = 'qq'
      wxAccountName.value = ''
    }
  }
  else {
    stopWxCheck()
    wxLoginStore.resetState()
    stopProxyPolling()
  }
})

watch(activeTab, (tab) => {
  if (tab === 'wx')
    loadWxQRCode()
  else if (tab === 'proxy')
    fetchProxyStatus()
})
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
    <div class="max-h-[90vh] max-w-md w-full overflow-hidden rounded-lg shadow-xl" :style="{ background: 'var(--theme-bg)' }">
      <div class="flex items-center justify-between border-b p-4" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
        <h3 class="text-lg font-semibold" :style="{ color: 'var(--theme-text)' }">
          {{ editData ? '编辑账号' : '添加账号' }}
        </h3>
        <BaseButton variant="ghost" class="!p-1" @click="close">
          <div class="i-carbon-close text-xl" :style="{ color: 'var(--theme-text)' }" />
        </BaseButton>
      </div>

      <div class="max-h-[calc(90vh-80px)] overflow-y-auto p-4">
        <div v-if="errorMessage" class="mb-4 rounded p-3 text-sm" :style="{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }">
          {{ errorMessage }}
        </div>

        <div class="mb-4 flex border-b" :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }">
          <button
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'manual' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'manual' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'manual'"
          >
            手动填码
          </button>
          <button
            v-if="wxLoginStore.config.enabled"
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'wx' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'wx' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'wx'"
          >
            微信扫码
          </button>
          <button
            v-if="!editData"
            class="flex-1 py-2 text-center text-sm font-medium transition-colors"
            :class="activeTab === 'proxy' ? 'border-b-2' : 'opacity-60'"
            :style="{
              color: activeTab === 'proxy' ? 'var(--theme-primary)' : 'var(--theme-text)',
              borderColor: 'var(--theme-primary)',
            }"
            @click="activeTab = 'proxy'"
          >
            QQ代理抓包
          </button>
        </div>


        <div v-if="activeTab === 'proxy'" class="space-y-4">
          <div
            class="rounded-lg p-3 text-xs"
            :style="{ background: proxyRunning ? 'rgba(34, 197, 94, 0.1)' : 'color-mix(in srgb, var(--theme-text) 5%, transparent)', color: 'var(--theme-text)' }"
          >
            <div class="flex items-center justify-between mb-2">
              <span class="font-medium">代理状态</span>
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                :style="{
                  background: proxyRunning ? 'rgba(34, 197, 94, 0.15)' : 'rgba(156, 163, 175, 0.15)',
                  color: proxyRunning ? '#16a34a' : '#9ca3af',
                }"
              >
                <span class="h-1.5 w-1.5 rounded-full" :style="{ background: proxyRunning ? '#16a34a' : '#9ca3af' }" />
                {{ proxyRunning ? '运行中' : '已停止' }}
              </span>
            </div>
            <div v-if="proxyRunning" class="space-y-1 opacity-80">
              <div>局域网代理: {{ proxyAddress }}:{{ proxyPort }}</div>
              <div v-if="proxyPublicAddress">公网代理: {{ proxyPublicAddress }}:{{ proxyPort }}</div>
              <div>已捕获 Code: {{ proxyCodes.length }} 个</div>
            </div>
            <div class="mt-2 flex gap-2">
              <BaseButton
                v-if="!proxyRunning"
                variant="primary"
                size="sm"
                :loading="proxyLoading"
                @click="startQQProxy"
              >
                开始抓取
              </BaseButton>
              <BaseButton
                v-else
                variant="outline"
                size="sm"
                @click="stopQQProxy"
              >
                停止抓取
              </BaseButton>
              <BaseButton
                variant="secondary"
                size="sm"
                href="/api/admin/qq-proxy/cert"
                target="_blank"
              >
                下载CA证书
              </BaseButton>
            </div>
          </div>

          <div class="rounded-lg p-3 text-xs space-y-2" :style="{ background: 'color-mix(in srgb, var(--theme-text) 5%, transparent)' }">
            <div class="font-medium" :style="{ color: 'var(--theme-text)' }">抓包登录使用说明</div>
            <ol class="list-decimal list-inside space-y-1 opacity-75" :style="{ color: 'var(--theme-text)' }">
              <li>点击<span class="font-medium">开始抓取</span>，获取代理地址和端口</li>
              <li>点击<span class="font-medium">下载CA证书</span>，在手机 Safari 打开下载链接安装证书<br/><span class="opacity-60">iPhone: 允许下载 → 设置 → 通用 → VPN与设备管理 → 安装 → 关于本机 → 证书信任设置 → 开启</span><br/><span class="opacity-60">Android: 设置 → 安全 → 加密与凭据 → 安装证书 → CA证书</span></li>
              <li>连续添加时，先切换到目标 QQ 并彻底关闭上一个农场</li>
              <li>将手机 Wi-Fi 代理设为显示的地址和端口</li>
              <li>彻底关闭后重新打开对应的 QQ 或微信农场</li>
              <li>Code 获取后账号会立即添加，QQ 好友 GID 将在后台继续同步</li>
              <li>QQ 农场保持打开，完整好友列表同步后会立即释放代理</li>
            </ol>
          </div>

          <div v-if="proxyCodes.length > 0" class="rounded-lg p-3 text-xs" :style="{ background: 'rgba(34, 197, 94, 0.05)', color: 'var(--theme-text)' }">
            <div class="font-medium mb-2">已捕获的 Code</div>
            <div
              v-for="(code, i) in proxyCodes"
              :key="i"
              class="flex items-center justify-between py-1 border-b border-dashed"
              :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 10%, transparent)' }"
            >
              <span class="font-mono text-xs opacity-75 truncate max-w-[200px]">{{ code }}</span>
              <span class="text-xs" style="color: #16a34a">已添加</span>
            </div>
          </div>

          <div class="text-center text-xs opacity-50" :style="{ color: 'var(--theme-text)' }">
            抓取过程中请保持手机 QQ 农场打开
          </div>
        </div>

        <div v-if="activeTab === 'wx'" class="space-y-4">
          <BaseInput
            v-model="wxAccountName"
            label="账号备注（可选）"
            placeholder="留空则使用微信昵称"
          />

          <div class="flex flex-col items-center justify-center py-4 space-y-4">
            <div
              v-if="wxQrImageSrc"
              class="border rounded-lg p-2"
              :style="{ borderColor: 'color-mix(in srgb, var(--theme-text) 20%, transparent)', background: '#fff' }"
            >
              <img :src="wxQrImageSrc" class="h-48 w-48">
            </div>
            <div
              v-else
              class="h-48 w-48 flex items-center justify-center rounded-lg"
              :style="{ background: 'color-mix(in srgb, var(--theme-bg) 90%, var(--theme-text))' }"
            >
              <div v-if="wxLoginStore.isLoading" i-svg-spinners-90-ring-with-bg class="text-3xl" :style="{ color: 'var(--theme-primary)' }" />
              <span v-else class="text-sm" :style="{ color: 'var(--theme-text)' }">点击获取二维码</span>
            </div>

            <p class="text-center text-sm" :style="{ color: 'var(--theme-text)' }">
              {{ wxLoginStore.statusMessage }}
            </p>

            <p v-if="wxLoginStore.errorMessage" class="text-center text-sm text-red-600">
              {{ wxLoginStore.errorMessage }}
            </p>

            <BaseButton variant="secondary" size="sm" :loading="wxLoginStore.isLoading" @click="loadWxQRCode">
              刷新二维码
            </BaseButton>
          </div>

          <div class="text-center text-xs opacity-60" :style="{ color: 'var(--theme-text)' }">
            使用微信扫描二维码登录，成功后会自动添加账号
          </div>
        </div>

        <div v-if="activeTab === 'manual'" class="space-y-4">
          <BaseInput
            v-model="form.name"
            label="账号备注（可选）"
            placeholder="留空则使用默认账号名"
          />

          <BaseTextarea
            v-model="form.code"
            label="Code"
            placeholder="请输入登录 Code"
            :rows="3"
          />

          <div v-if="!editData" class="flex gap-4">
            <label class="flex cursor-pointer items-center gap-2">
              <input
                v-model="form.platform"
                type="radio"
                value="qq"
                class="h-4 w-4"
                :style="{ accentColor: 'var(--theme-primary)' }"
              >
              <span class="text-sm" :style="{ color: 'var(--theme-text)' }">QQ 小程序</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input
                v-model="form.platform"
                type="radio"
                value="wx"
                class="h-4 w-4"
                :style="{ accentColor: 'var(--theme-primary)' }"
              >
              <span class="text-sm" :style="{ color: 'var(--theme-text)' }">微信小程序</span>
            </label>
          </div>

          <div class="flex justify-end gap-2 pt-4">
            <BaseButton variant="outline" @click="close">
              取消
            </BaseButton>
            <BaseButton variant="primary" :loading="loading" @click="submitManual">
              {{ editData ? '保存' : '添加' }}
            </BaseButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
