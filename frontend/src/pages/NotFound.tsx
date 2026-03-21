import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center p-8">
        <div className="text-6xl font-bold text-gray-300 mb-4">404</div>
        <h2 className="text-xl font-semibold text-gray-700 mb-2">Page Not Found</h2>
        <p className="text-gray-500 mb-6">The page you're looking for doesn't exist.</p>
        <Link to="/" className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
