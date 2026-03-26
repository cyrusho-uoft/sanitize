let currentStep = 1;
const totalSteps = 3;

const btnNext = document.getElementById('btn-next') as HTMLButtonElement;
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;

function showStep(step: number) {
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.dot').forEach(el => el.classList.remove('active'));

  document.querySelector(`.step[data-step="${step}"]`)?.classList.add('active');
  document.querySelector(`.dot[data-step="${step}"]`)?.classList.add('active');

  btnBack.hidden = step === 1;
  btnNext.textContent = step === totalSteps ? "Got it — let's go!" : 'Next';

  currentStep = step;
}

btnNext.addEventListener('click', async () => {
  if (currentStep < totalSteps) {
    showStep(currentStep + 1);
  } else {
    // Save mode selection and mark onboarding complete
    const selectedMode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement)?.value || 'A';
    await chrome.storage.local.set({
      mode: selectedMode,
      onboardingComplete: true,
    });
    // Close the onboarding tab
    window.close();
  }
});

btnBack.addEventListener('click', () => {
  if (currentStep > 1) {
    showStep(currentStep - 1);
  }
});

// Mode option radio buttons — update visual selection
document.querySelectorAll('.mode-option').forEach(option => {
  option.addEventListener('click', () => {
    document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('selected'));
    option.classList.add('selected');
    const radio = option.querySelector('input[type="radio"]') as HTMLInputElement;
    if (radio) radio.checked = true;
  });
});
