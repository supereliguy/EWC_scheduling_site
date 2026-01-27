document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;
    const messageEl = document.getElementById('message');

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.ok) {
            messageEl.textContent = 'Login successful! Redirecting...';
            messageEl.style.color = 'green';
            if (data.user.role === 'admin') {
                window.location.href = '/admin.html';
            } else {
                window.location.href = '/index.html';
            }
        } else {
            messageEl.textContent = data.error || 'Login failed';
            messageEl.style.color = 'red';
        }
    } catch (error) {
        console.error(error);
        messageEl.textContent = 'An error occurred';
        messageEl.style.color = 'red';
    }
});
