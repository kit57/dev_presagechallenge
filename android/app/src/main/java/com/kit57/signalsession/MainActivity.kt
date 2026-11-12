package com.kit57.signalsession

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.InputFilter
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.VideoView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import android.app.AlertDialog
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.presagetech.smartspectra.CameraSelection
import com.presagetech.smartspectra.ProcessingStatus
import com.presagetech.smartspectra.SmartSpectraConfig
import com.presagetech.smartspectra.SmartSpectraSdk
import kotlinx.coroutines.launch
import org.json.JSONArray
import java.util.Locale

class MainActivity : ComponentActivity() {
    private companion object {
        const val PREFS_NAME = "signal_session"
        const val KEY_NOTES = "notes"
        const val KEY_PROMPTS = "prompts"
        const val KEY_EXPIRES_AT = "expires_at"
        const val RETENTION_MILLIS = 30L * 24 * 60 * 60 * 1000
        const val COLOR_GREEN = 0xFF216C55.toInt()
        const val COLOR_INK = 0xFF1D2724.toInt()
        const val COLOR_MUTED = 0xFF65726B.toInt()
        const val COLOR_CANVAS = 0xFFF5F6F4.toInt()
    }

    private val sdk by lazy { SmartSpectraSdk.shared }
    private val preferences by lazy { getSharedPreferences(PREFS_NAME, MODE_PRIVATE) }
    private val starterPrompts = listOf(
        "Could you tell me what happened from your perspective?",
        "What do you remember most clearly about that day?",
    )

    private lateinit var previewView: PreviewView
    private lateinit var previewPlaceholder: TextView
    private lateinit var statusLabel: TextView
    private lateinit var validationLabel: TextView
    private lateinit var breathingRateLabel: TextView
    private lateinit var confidenceLabel: TextView
    private lateinit var promptList: LinearLayout
    private lateinit var notesInput: EditText
    private lateinit var startButton: Button
    private lateinit var saveStatus: TextView
    private lateinit var deleteSavedButton: Button
    private lateinit var withdrawButton: Button
    private lateinit var selectedMedia: FrameLayout

    private var consentGranted = false
    private var loadingSavedSession = false
    private var prompts = starterPrompts.toMutableList()

    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            startMeasurement()
        } else {
            statusLabel.text = "Camera permission is required for a live measurement."
        }
    }

    private val mediaPicker = registerForActivityResult(
        ActivityResultContracts.GetContent(),
    ) { uri ->
        if (uri != null) showSelectedMedia(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        bindSdk()
        purgeExpiredSession()
        statusLabel.text = "Idle · consent required before camera access"
    }

    override fun onPause() {
        super.onPause()
        if (selectedMedia.childCount > 0) {
            (selectedMedia.getChildAt(0) as? VideoView)?.pause()
        }
        val state = sdk.processingStatus.value
        if (state == ProcessingStatus.RUNNING || state == ProcessingStatus.STARTING) {
            lifecycleScope.launch {
                try {
                    sdk.stop()
                } catch (error: Exception) {
                    statusLabel.text = "Could not stop measurement: ${error.message ?: "SDK error"}"
                }
            }
        }
    }

    private fun buildUi() {
        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(20), dp(18), dp(24))
            setBackgroundColor(COLOR_CANVAS)
        }
        val scrollView = ScrollView(this).apply {
            addView(page)
            clipToPadding = false
        }

        page.addView(label("SIGNAL SESSION  /  SMARTSPECTRA", 12, COLOR_GREEN, true))
        page.addView(label("A thoughtful conversation.", 25, COLOR_INK, true), bottomMargin(dp(6)))
        page.addView(label("Live breathing signals for consensual research and conversation.", 14, COLOR_MUTED), bottomMargin(dp(16)))

        val notice = label(
            "Signals are not truth. Breathing and other wellness measurements cannot show whether someone is being truthful or support medical decisions.",
            13,
            COLOR_INK,
        )
        notice.setPadding(dp(14), dp(12), dp(14), dp(12))
        notice.setBackgroundColor(Color.WHITE)
        page.addView(notice, bottomMargin(dp(16)))

        page.addView(sectionTitle("Participant camera"))
        val cameraFrame = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }
        previewView = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            contentDescription = "Live participant camera preview"
        }
        previewPlaceholder = label("Camera stays off until the participant agrees.", 14, Color.WHITE).apply {
            gravity = Gravity.CENTER
            setBackgroundColor(0xAA000000.toInt())
        }
        cameraFrame.addView(previewView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(260),
        ))
        cameraFrame.addView(previewPlaceholder, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(260),
        ))
        page.addView(cameraFrame, bottomMargin(dp(10)))

        statusLabel = label("Idle", 13, COLOR_MUTED)
        validationLabel = label("Waiting for camera and signal quality checks.", 13, COLOR_MUTED)
        page.addView(statusLabel, bottomMargin(dp(4)))
        page.addView(validationLabel, bottomMargin(dp(12)))

        breathingRateLabel = label("—", 38, COLOR_GREEN, true)
        page.addView(sectionTitle("Live breathing rate"))
        page.addView(breathingRateLabel, bottomMargin(dp(2)))
        page.addView(label("breaths per minute", 13, COLOR_MUTED), bottomMargin(dp(4)))
        confidenceLabel = label("Waiting for a full measurement window.", 12, COLOR_MUTED)
        page.addView(confidenceLabel, bottomMargin(dp(14)))

        startButton = Button(this).apply {
            text = "Review consent & start"
            setOnClickListener {
                if (consentGranted) requestCameraAndStart() else showConsentDialog()
            }
        }
        page.addView(startButton, bottomMargin(dp(4)))
        page.addView(Button(this).apply {
            text = "Review camera & data consent"
            setOnClickListener { showConsentDialog() }
        }, bottomMargin(dp(4)))
        page.addView(Button(this).apply {
            text = "Stop measurement"
            setOnClickListener { stopMeasurement() }
        }, bottomMargin(dp(8)))

        withdrawButton = Button(this).apply {
            text = "Withdraw consent & delete saved notes"
            visibility = View.GONE
            setOnClickListener { confirmWithdrawConsent() }
        }
        page.addView(withdrawButton, bottomMargin(dp(18)))

        page.addView(sectionTitle("Conversation prompts"))
        promptList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        page.addView(promptList, bottomMargin(dp(8)))
        page.addView(Button(this).apply {
            text = "Add a question"
            setOnClickListener { addQuestion() }
        }, bottomMargin(dp(4)))

        val mediaButtons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(Button(context).apply {
                text = "Choose image"
                setOnClickListener { mediaPicker.launch("image/*") }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(Button(context).apply {
                text = "Choose video"
                setOnClickListener { mediaPicker.launch("video/*") }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        page.addView(mediaButtons, bottomMargin(dp(8)))
        selectedMedia = FrameLayout(this).apply { visibility = View.GONE }
        page.addView(selectedMedia, bottomMargin(dp(16)))

        page.addView(sectionTitle("Session notes · optional"))
        notesInput = EditText(this).apply {
            hint = "Add a note or observation…"
            minLines = 3
            maxLines = 6
            gravity = Gravity.TOP
            filters = arrayOf(InputFilter.LengthFilter(5_000))
            setPadding(dp(12), dp(10), dp(12), dp(10))
            setBackgroundColor(Color.WHITE)
        }
        page.addView(notesInput, bottomMargin(dp(4)))
        saveStatus = label("Not saved until participant consent.", 12, COLOR_MUTED)
        page.addView(saveStatus)
        deleteSavedButton = Button(this).apply {
            text = "Delete saved copy"
            visibility = View.GONE
            setOnClickListener { confirmDeleteSavedCopy() }
        }
        page.addView(deleteSavedButton, bottomMargin(dp(8)))

        notesInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                if (!loadingSavedSession) saveLocalSession()
            }
        })

        setContentView(scrollView)
        renderPrompts()
    }

    private fun bindSdk() {
        sdk.config.imageOutputEnabled = false
        sdk.config.enableTelemetry = false
        sdk.config.requestedMetrics = SmartSpectraConfig.breathingMetrics
        sdk.config.previewSurfaceProvider = previewView.surfaceProvider
        sdk.useCamera(CameraSelection.Front)

        sdk.processingStatus.observe(this) { state ->
            when (state) {
                ProcessingStatus.IDLE -> {
                    statusLabel.text = "Idle"
                    previewPlaceholder.visibility = View.VISIBLE
                    resetMetrics()
                }
                ProcessingStatus.STARTING -> statusLabel.text = "Starting SmartSpectra…"
                ProcessingStatus.RUNNING -> {
                    statusLabel.text = "SmartSpectra is measuring"
                    previewPlaceholder.visibility = View.GONE
                }
                ProcessingStatus.STOPPING -> statusLabel.text = "Stopping measurement…"
                ProcessingStatus.ERROR -> {
                    statusLabel.text = "SmartSpectra error · check the key and network"
                    previewPlaceholder.visibility = View.VISIBLE
                    resetMetrics()
                }
                null -> Unit
            }
        }
        sdk.validationStatus.observe(this) { validation ->
            validationLabel.text = validation?.hint?.takeIf { it.isNotBlank() }
                ?: "Follow camera guidance and keep still for a reliable signal."
        }
        sdk.error.observe(this) { error ->
            if (error != null) {
                statusLabel.text = "SDK error: ${error.message ?: "SmartSpectra error"}"
            }
        }
        sdk.metrics.observe(this) { metrics ->
            val sample = metrics?.breathing?.rateList?.lastOrNull()
            if (sample != null) {
                breathingRateLabel.text = String.format(Locale.ROOT, "%.1f", sample.value)
                val confidence = sample.confidence.toInt()
                confidenceLabel.text = "Signal confidence: $confidence% · ${
                    if (sample.stable) "stable" else "not stable"
                }"
            }
        }
    }

    private fun showConsentDialog() {
        val agreement = CheckBox(this).apply {
            text = "I am the participant, at least 18 years old, and I voluntarily agree."
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
        val details = """
            SmartSpectra uses the live camera on this phone to estimate breathing rate. No microphone is requested, and this app does not record video or save video or breathing readings.

            Only question prompts and notes are stored in this app's private storage on this phone after consent. They expire 30 days after first save and are removed the next time the app opens after expiry. Selected image/video stimuli are previewed locally and are not saved.

            The SDK authenticates with Presage using the API key configured for this personal build. SDK telemetry is disabled. No optional AI service is used.

            These wellness signals are not evidence of truthfulness and must not be used for diagnosis, treatment, or medical decisions. You may decline or stop at any time.
        """.trimIndent()
        val dialog = AlertDialog.Builder(this)
            .setTitle("Camera & data consent")
            .setMessage(details)
            .setView(agreement)
            .setNegativeButton("Not now", null)
            .setPositiveButton("Agree & continue", null)
            .create()

        dialog.setOnShowListener {
            val agreeButton = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            agreeButton.isEnabled = false
            agreement.setOnCheckedChangeListener { _, checked -> agreeButton.isEnabled = checked }
            agreeButton.setOnClickListener {
                if (!agreement.isChecked) return@setOnClickListener
                val consentWasAlreadyGranted = consentGranted
                consentGranted = true
                startButton.text = "Start measurement"
                withdrawButton.visibility = View.VISIBLE
                dialog.dismiss()
                if (!consentWasAlreadyGranted) {
                    loadSavedSession()
                    requestCameraAndStart()
                }
            }
        }
        dialog.show()
    }

    private fun requestCameraAndStart() {
        if (BuildConfig.PRESAGE_API_KEY.isBlank()) {
            statusLabel.text = "Add presage.apiKey to android/local.properties before starting."
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
            return
        }
        startMeasurement()
    }

    private fun startMeasurement() {
        if (!consentGranted) {
            showConsentDialog()
            return
        }
        sdk.config.apiKey = BuildConfig.PRESAGE_API_KEY
        lifecycleScope.launch {
            try {
                sdk.start()
            } catch (error: Exception) {
                statusLabel.text = "Could not start SmartSpectra: ${error.message ?: "SDK error"}"
            }
        }
    }

    private fun stopMeasurement() {
        val state = sdk.processingStatus.value
        if (state != ProcessingStatus.RUNNING && state != ProcessingStatus.STARTING) return
        lifecycleScope.launch {
            try {
                sdk.stop()
            } catch (error: Exception) {
                statusLabel.text = "Could not stop SmartSpectra: ${error.message ?: "SDK error"}"
            }
        }
    }

    private fun confirmWithdrawConsent() {
        AlertDialog.Builder(this)
            .setTitle("Withdraw consent?")
            .setMessage("This stops measurement and deletes the saved questions and notes from this app.")
            .setNegativeButton("Keep consent", null)
            .setPositiveButton("Withdraw & delete") { _, _ ->
                consentGranted = false
                startButton.text = "Review consent & start"
                withdrawButton.visibility = View.GONE
                preferences.edit()
                    .remove(KEY_NOTES)
                    .remove(KEY_PROMPTS)
                    .remove(KEY_EXPIRES_AT)
                    .apply()
                loadingSavedSession = true
                notesInput.setText("")
                prompts = starterPrompts.toMutableList()
                renderPrompts()
                loadingSavedSession = false
                saveStatus.text = "Saved questions and notes deleted."
                deleteSavedButton.visibility = View.GONE
                selectedMedia.removeAllViews()
                selectedMedia.visibility = View.GONE
                breathingRateLabel.text = "—"
                confidenceLabel.text = "Waiting for a full measurement window."
                stopMeasurement()
            }
            .show()
    }

    private fun confirmDeleteSavedCopy() {
        AlertDialog.Builder(this)
            .setTitle("Delete saved copy?")
            .setMessage("This removes saved questions and notes from this phone. The current page stays open.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Delete") { _, _ ->
                preferences.edit()
                    .remove(KEY_NOTES)
                    .remove(KEY_PROMPTS)
                    .remove(KEY_EXPIRES_AT)
                    .apply()
                deleteSavedButton.visibility = View.GONE
                saveStatus.text = "Saved copy deleted · current page data remains open."
            }
            .show()
    }

    private fun addQuestion() {
        if (prompts.size >= 50) {
            statusLabel.text = "A session can contain up to 50 prompts."
            return
        }
        val input = EditText(this).apply {
            hint = "What would you like to ask?"
            maxLines = 4
            filters = arrayOf(InputFilter.LengthFilter(240))
        }
        AlertDialog.Builder(this)
            .setTitle("Add a neutral question")
            .setMessage("Use open-ended, non-accusatory wording.")
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Add") { _, _ ->
                val question = input.text.toString().trim()
                if (question.isNotEmpty()) {
                    prompts.add(question)
                    renderPrompts()
                    saveLocalSession()
                }
            }
            .show()
    }

    private fun showSelectedMedia(uri: Uri) {
        selectedMedia.removeAllViews()
        val mimeType = contentResolver.getType(uri).orEmpty()
        val preview = if (mimeType.startsWith("video/")) {
            VideoView(this).apply {
                setVideoURI(uri)
                setOnPreparedListener { it.setVolume(0f, 0f) }
                setMediaController(android.widget.MediaController(this@MainActivity).also {
                    it.setAnchorView(this)
                })
            }
        } else {
            ImageView(this).apply {
                setImageURI(uri)
                scaleType = ImageView.ScaleType.FIT_CENTER
                contentDescription = "Selected image stimulus preview"
            }
        }
        selectedMedia.addView(preview, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(220),
        ))
        selectedMedia.visibility = View.VISIBLE
    }

    private fun loadSavedSession() {
        val storedPrompts = preferences.getString(KEY_PROMPTS, null)
        val storedNotes = preferences.getString(KEY_NOTES, null)
        if (storedPrompts == null && storedNotes == null) {
            saveLocalSession()
            return
        }
        try {
            val promptArray = JSONArray(storedPrompts ?: "[]")
            prompts = MutableList(promptArray.length()) { index -> promptArray.getString(index) }
            if (prompts.isEmpty()) prompts = starterPrompts.toMutableList()
            loadingSavedSession = true
            notesInput.setText(storedNotes.orEmpty())
            renderPrompts()
            loadingSavedSession = false
            deleteSavedButton.visibility = View.VISIBLE
            val expiry = preferences.getLong(KEY_EXPIRES_AT, 0)
            saveStatus.text = "Saved on this phone · expires ${
                android.text.format.DateFormat.getMediumDateFormat(this).format(expiry)
            }"
        } catch (error: org.json.JSONException) {
            loadingSavedSession = false
            statusLabel.text = "Could not read the saved session: ${error.message}"
        }
    }

    private fun purgeExpiredSession() {
        val expiry = preferences.getLong(KEY_EXPIRES_AT, 0)
        if (expiry > 0 && expiry <= System.currentTimeMillis()) {
            preferences.edit()
                .remove(KEY_NOTES)
                .remove(KEY_PROMPTS)
                .remove(KEY_EXPIRES_AT)
                .apply()
        }
    }

    private fun saveLocalSession() {
        if (!consentGranted || loadingSavedSession) return
        val existingExpiry = preferences.getLong(KEY_EXPIRES_AT, 0)
        val expiry = if (existingExpiry > System.currentTimeMillis()) {
            existingExpiry
        } else {
            System.currentTimeMillis() + RETENTION_MILLIS
        }
        val promptArray = JSONArray().apply { prompts.forEach { put(it) } }
        preferences.edit()
            .putString(KEY_NOTES, notesInput.text.toString())
            .putString(KEY_PROMPTS, promptArray.toString())
            .putLong(KEY_EXPIRES_AT, expiry)
            .apply()
        saveStatus.text = "Saved on this phone · expires ${
            android.text.format.DateFormat.getMediumDateFormat(this).format(expiry)
        }"
    }

    private fun renderPrompts() {
        promptList.removeAllViews()
        prompts.forEachIndexed { index, prompt ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(10), dp(4), dp(4), dp(4))
                setBackgroundColor(Color.WHITE)
            }
            row.addView(label(String.format(Locale.ROOT, "%02d", index + 1), 12, COLOR_GREEN, true), LinearLayout.LayoutParams(
                dp(34),
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ))
            row.addView(label(prompt, 14, COLOR_INK), LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1f,
            ))
            row.addView(Button(this).apply {
                text = "×"
                contentDescription = "Remove question ${index + 1}"
                setOnClickListener {
                    prompts.removeAt(index)
                    renderPrompts()
                    saveLocalSession()
                }
            })
            promptList.addView(row, bottomMargin(dp(6)))
        }
    }

    private fun resetMetrics() {
        breathingRateLabel.text = "—"
        confidenceLabel.text = "Waiting for a full measurement window."
    }

    private fun sectionTitle(title: String): TextView =
        label(title, 17, COLOR_INK, true).apply {
            setPadding(0, dp(4), 0, dp(8))
        }

    private fun label(text: String, sizeSp: Int, color: Int, bold: Boolean = false): TextView =
        TextView(this).apply {
            this.text = text
            textSize = sizeSp.toFloat()
            setTextColor(color)
            if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

    private fun bottomMargin(margin: Int): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { bottomMargin = margin }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
